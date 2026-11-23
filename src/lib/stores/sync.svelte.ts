// Client-side account, sync status, and real transfer progress for full-size photo backups.

import type { Note, NoteImage } from '#lib/types.js';
import { mergeKanbanBoards } from '#lib/kanban.js';
import { mergeCanvasLibrary } from '#lib/canvasLibrary.js';
import { mergeLabelLists, mergeNoteLists, uid, withoutTombstoned } from '#lib/model/index.js';
import {
	SYNC_DELTA_PATH,
	SYNC_PROTOCOL_HEADER,
	SYNC_PROTOCOL_VERSION
} from '#lib/model/protocol.js';
import { observeRelayTime } from '#lib/editContext.js';
import {
	currentRecordKeys,
	emptyRelayAttachments,
	fingerprintMapFrom,
	noteRecordForRelay,
	planDeletableKeys,
	reconcileBaseline,
	referencedAttachmentIds,
	relayHeldVersions,
	syncRoundHasMore,
	syncControlKeys,
	type RelayAttachments
} from '#lib/syncEngine.js';
import { SyncEventsClient } from '#lib/syncEventsClient.js';
import { withoutAttachmentsHistoryNeeds } from '#lib/attachmentRetention.js';
import {
	attachmentToImage,
	attachmentRefKey,
	buildSyncRecords,
	hydrateNoteImages,
	isSyncRecordPayload,
	syncRecordKey,
	syncSnapshot,
	type SyncRecord,
	type SyncRecordPayload,
	type SyncSnapshot
} from '#lib/syncRecords.js';
import { MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST } from '#lib/syncLimits.js';
import {
	RELAY_SILENCE_MS,
	SYNC_TIMED_OUT,
	retryTransient,
	transientRetry,
	untilAborted,
	wait,
	withinTime
} from '#lib/syncRetry.js';
import { sha256 } from '#lib/syncHash.js';
import { serverUrl } from '#lib/serverOrigin.svelte.js';
import {
	createOneTimePairingCode,
	createPairingRequestKey,
	createSyncIdentity,
	identityFromSyncKey,
	openSyncKeyFromPeer,
	pairingCodeTag,
	sealSyncKeyForPeer,
	signSyncChallenge,
	signSyncRegistration,
	encryptSyncPayload,
	decryptSyncPayload,
	randomOpaqueId
} from '#lib/syncPairing.js';
import { PairingRole, PairingState, type PairingPoll } from '#lib/pairingProtocol.js';
import {
	clearSyncOutbox,
	commitSyncControl,
	DeleteBlockedError,
	deleteSyncState,
	getOutboxGeneration,
	getSyncOutboxKeys,
	getSyncState,
	isProfileReleased,
	markSyncOutbox,
	setRegisteredWorkspaces
} from '#lib/db/idb.js';
import {
	getLastActiveProfileId,
	isLocalWorkspace,
	loadProfiles,
	readProfiles,
	nextProfileName,
	pickBootProfile,
	removeProfileRecord,
	saveProfile,
	setLastActiveProfileId,
	type StoredProfile
} from '#lib/profiles.js';

const LS_SYNC_STATUS_PREFIX = 'scrapscache-sync-status';
/**
 * How long an answer about which photos a note's history needs is trusted. The relay can
 * drop old versions for quota without the note changing; a photo they named waits at
 * most this long, plus a sync, to be reclaimed.
 */
export const HISTORY_RECHECK_MS = 60 * 60_000;

/** A protocol refusal cannot tell whether the app or the relay needs updating. */
export const SYNC_VERSION_MISMATCH_MESSAGE =
	'This app and the sync server use different versions. Save and close any open editors, then reload the app. If sync still fails, update the sync server.';

/** Encrypted profile-name record; the name follows its sync key across devices. */
export const PROFILE_META_KEY = 'profile-meta';

export interface SyncAccount {
	syncKey: string;
	accountId: string;
	authPublicKey: string;
	pairingCode: string;
}

export type StartedDeviceLink = {
	id: string;
	expiresAt: number;
	role: PairingRole;
	syncCode: string;
	pake: { ephemeralSecret: string; share: string };
};

interface SyncStatus {
	lastSync: number;
}

export type McpWorkspaceStatus = { state: 'local' } | { state: 'ready' } | { state: 'unavailable' };

function parseLastSync(raw: string | null): number {
	if (!raw) return 0;
	try {
		return Number((JSON.parse(raw) as SyncStatus).lastSync) || 0;
	} catch {
		return 0;
	}
}

export interface SyncProgress {
	phase: 'upload' | 'download';
	loadedBytes: number;
	totalBytes: number | null;
}

export interface SyncUsage {
	ciphertextBytes: number;
	envelopeCount: number;
	storageBytes: number;
	maxBytes: number;
}

type SyncResult = {
	success: boolean;
	/** The workspace as the sync left it. */
	snapshot?: SyncSnapshot;
	data?: Record<string, unknown>;
	error?: string;
	/** HTTP status of a failed request; lets callers react to codes, not message text. */
	status?: number;
	/** How long a throttled or busy relay asked the client to wait before trying again. */
	retryAfterSeconds?: number;
	/** The relay was not reached or could not serve the request; sending it again is safe. */
	transient?: boolean;
	/** The relay was reset, so the next sync has to send this device's whole copy. */
	bootstrap?: boolean;
	/** The relay answered and will not take this as it is: asking again changes nothing. */
	refused?: boolean;
	/** The relay was not reached, or did not answer: nothing here is wrong. */
	unreachable?: boolean;
	/**
	 * After `readRelay`: the sync state of a device that holds exactly `snapshot`,
	 * by its workspace state key. Whoever writes that copy commits this with it.
	 */
	control?: Record<string, unknown>;
};

/** A request that never got an answer, as `fetch` and the time limit report it. */
function relayNotReached(error: unknown): boolean {
	return error instanceof TypeError || (error instanceof Error && error.message === SYNC_TIMED_OUT);
}

/**
 * How a sync of a workspace ended, for whoever decides when it runs next: settled
 * with the relay; failed in a way that trying again later may get past; or refused
 * by the relay, which the same request would be again.
 */
export type SyncOutcome = 'synced' | 'failed' | 'refused';

export function syncOutcome(result: { success: boolean; refused?: boolean }): SyncOutcome {
	if (result.success) return 'synced';
	return result.refused ? 'refused' : 'failed';
}

/** The workspace a sync runs for, and the account it syncs with. */
type SyncTarget = { account: SyncAccount; pid: string };

/** Shown when a sync settled but left out photos this device could not read. */
const UNREADABLE_ATTACHMENTS =
	'Synced, but some photos could not be prepared for upload. They will retry on the next sync.';

/**
 * Applies what a flight pulled. The workspace is handed over with it: a flight
 * belongs to the workspace it started in, and the window may have moved to
 * another one by the time the bytes are decrypted.
 */
export type ApplyPulled = (
	snapshot: SyncSnapshot,
	pid: string,
	pulled: PulledRelayState
) => Promise<SyncSnapshot>;

/** What a drained download tells the notes store about the relay. */
export type PulledRelayState = {
	/** True when the relay holds this attachment version and a note there lists it. */
	relayHolds: (id: string, hash: string) => boolean;
	/** Record the version found when the relay was asked for an attachment by name. */
	relayHas: (id: string, hash: string | null) => void;
	/** Queue records this device now has to send. */
	owes: (keys: string[]) => Promise<void>;
};

function mergeTombstoneMaps(
	local: Record<string, number>,
	remote: unknown
): Record<string, number> {
	if (!remote || typeof remote !== 'object') return local;
	const merged = { ...local };
	for (const [id, timestamp] of Object.entries(remote as Record<string, unknown>)) {
		const value = Number(timestamp) || 0;
		if (value > (merged[id] || 0)) merged[id] = value;
	}
	return merged;
}

/** What is known of one workspace's sync. */
export type WorkspaceSyncState = {
	lastSync: number;
	lastError: string | null;
	/** The error of the last sync that failed only because the relay was not reached. */
	unreachableError: string | null;
	/** The key's cloud data was deleted, so the relay will never accept it again.
	 * The workspace can only keep syncing on a new key. */
	keyRetired: boolean;
	progress: SyncProgress | null;
	usage: SyncUsage | null;
	syncedCursor: number;
};

const NOTHING_KNOWN: Readonly<WorkspaceSyncState> = Object.freeze({
	lastSync: 0,
	lastError: null,
	unreachableError: null,
	keyRetired: false,
	progress: null,
	usage: null,
	syncedCursor: 0
});

export class SyncStore {
	account = $state<SyncAccount | null>(null);
	/**
	 * Every workspace's sync state, by workspace, with the key it was learned under:
	 * under another key, or none, nothing of it holds. A sync records what happened
	 * for the workspace it ran for, whichever one a window shows; the indicator and
	 * Sync settings read the open workspace's through the accessors below.
	 */
	private states = $state<Record<string, WorkspaceSyncState & { key: string }>>({});

	private keyOf(pid: string): string {
		return this.profiles.find((entry) => entry.id === pid)?.syncKey ?? '';
	}

	/**
	 * A workspace's sync state, to record into. What a sync learned under `syncKey`
	 * is recorded only while the workspace is still on that key.
	 */
	private state(pid: string, syncKey?: string): WorkspaceSyncState {
		const key = this.keyOf(pid);
		if (syncKey !== undefined && syncKey !== key) return { ...NOTHING_KNOWN };
		if (this.states[pid]?.key !== key) this.states[pid] = { ...NOTHING_KNOWN, key };
		return this.states[pid];
	}

	/** What is known of a workspace's sync, whichever workspace this window shows. */
	stateOf(pid: string): Readonly<WorkspaceSyncState> {
		const state = this.states[pid];
		return state && state.key === this.keyOf(pid) ? state : NOTHING_KNOWN;
	}

	get lastSync(): number {
		return this.stateOf(this.activeId).lastSync;
	}
	set lastSync(value: number) {
		this.state(this.activeId).lastSync = value;
	}
	get lastError(): string | null {
		return this.stateOf(this.activeId).lastError;
	}
	set lastError(value: string | null) {
		this.state(this.activeId).lastError = value;
	}
	get keyRetired(): boolean {
		return this.stateOf(this.activeId).keyRetired;
	}
	set keyRetired(value: boolean) {
		this.state(this.activeId).keyRetired = value;
	}
	get progress(): SyncProgress | null {
		return this.stateOf(this.activeId).progress;
	}
	set progress(value: SyncProgress | null) {
		this.state(this.activeId).progress = value;
	}
	get usage(): SyncUsage | null {
		return this.stateOf(this.activeId).usage;
	}
	set usage(value: SyncUsage | null) {
		this.state(this.activeId).usage = value;
	}
	get syncedCursor(): number {
		return this.stateOf(this.activeId).syncedCursor;
	}
	set syncedCursor(value: number) {
		this.state(this.activeId).syncedCursor = value;
	}

	/**
	 * True while the open workspace's last sync failed only because the relay could
	 * not be reached. Nothing is wrong on this device and nothing is asked of the
	 * user: what was saved here waits, and the scheduler tries again.
	 */
	get relayUnreachable(): boolean {
		const { lastError, unreachableError } = this.stateOf(this.activeId);
		return lastError !== null && lastError === unreachableError;
	}
	readonly syncClientId = uid();
	/** Every workspace on this device. Synced ones carry a sync key. */
	profiles = $state<StoredProfile[]>([]);
	/** The workspace this window reads and writes. */
	/** Empty until the keyring names a workspace for this window. */
	activeId = $state('');
	private profilesReady: Promise<void> | null = null;
	private pendingOutboxWrites: Promise<void> = Promise.resolve();
	/** Sign-ins by account: a workspace's is good whichever workspace a window shows. */
	private sessions = new Map<string, { accessToken: string; expiresAt: number }>();
	private pendingSessions = new Map<string, Promise<string>>();
	/**
	 * Attachment ids a note's retained versions list, as of the note's last change. Quota
	 * eviction can drop a version without changing the note, so an answer is also only
	 * trusted for HISTORY_RECHECK_MS; until then a photo it still names is just kept longer.
	 */
	private versionAttachments = new Map<
		string,
		{ updatedAt: number; checkedAt: number; ids: Set<string> }
	>();
	/** Notes open in the editor, by record key, with the envelope id each session last uploaded. */
	private editSessions = new Map<string, { uploadedId: string | null }>();
	private authenticationGeneration = 0;

	// Non-reactive callbacks avoid re-rendering the note grid for cloud feedback.
	onSyncStart: (() => void) | null = null;
	onSyncEnd: (() => void) | null = null;
	onAccountChange: (() => void) | null = null;
	/** Registered by the central data store so board edits share its debounced sync. */
	onLocalDataChange: (() => void) | null = null;
	/** Called when a workspace other than the open one has something new to send. */
	onWorkspaceOwes: ((pid: string) => void) | null = null;

	constructor() {
		if (typeof localStorage === 'undefined') return;
		this.initFromLocalStorage();
		void this.ensureProfilesLoaded();
	}

	/** Fast boot from the keyring. */
	private initFromLocalStorage(): void {
		try {
			this.profiles = readProfiles();
			const pointerId = getLastActiveProfileId();
			const pointed = pointerId
				? (this.profiles.find((entry) => entry.id === pointerId) ?? null)
				: null;
			const chosen = pointed ?? pickBootProfile(this.profiles);
			if (chosen) this.activateProfile(chosen);
		} catch (err) {
			console.error('[sync] could not restore profiles on boot:', err);
		}
	}

	get isLoggedIn(): boolean {
		return this.account !== null;
	}

	get activeProfile(): StoredProfile | null {
		return this.profiles.find((profile) => profile.id === this.activeId) ?? null;
	}

	/** Namespace this window reads and writes right now. */
	get activePid(): string {
		return this.activeId;
	}

	/**
	 * Per-window boot: restore the keyring and activate the last-used profile.
	 * A device with no workspace gets a private one. Windows opened later start
	 * on the same profile but can switch independently.
	 */
	ensureProfilesLoaded(): Promise<void> {
		this.profilesReady ??= (async () => {
			try {
				let profiles = await loadProfiles();
				if (profiles.length === 0) {
					const workspace: StoredProfile = {
						id: randomOpaqueId(),
						name: nextProfileName(profiles),
						syncKey: '',
						createdAt: Date.now()
					};
					await saveProfile(workspace);
					profiles = [workspace];
				}
				// The service worker finds workspaces through this list, so it follows the keyring.
				void setRegisteredWorkspaces(profiles).catch(() => undefined);
				this.profiles = profiles.sort((a, b) => a.createdAt - b.createdAt);

				const pointerId = getLastActiveProfileId();
				const pointed = pointerId
					? (this.profiles.find((entry) => entry.id === pointerId) ?? null)
					: null;
				const chosen = pointed ?? pickBootProfile(this.profiles);
				if (chosen && chosen.id !== this.activeId) this.activateProfile(chosen);
			} catch (err) {
				console.error('[sync] could not load saved profiles:', err);
			}
		})();
		return this.profilesReady;
	}

	/** Adopt the keyring as another window has just rewritten it. */
	reloadKeyring(): StoredProfile[] {
		this.profiles = readProfiles();
		return this.profiles;
	}

	/** Persist a keyring entry and surface it in the reactive profile list. */
	async addKeyringEntry(profile: StoredProfile): Promise<void> {
		await saveProfile(profile);
		this.profiles = [...this.profiles, profile].sort((a, b) => a.createdAt - b.createdAt);
	}

	async renameProfile(id: string, name: string): Promise<StoredProfile | null> {
		const trimmed = name.trim().slice(0, 60);
		if (!trimmed) return null;
		const profile = this.profiles.find((entry) => entry.id === id);
		if (!profile || profile.name === trimmed) return profile ?? null;
		const updated = { ...profile, name: trimmed };
		await saveProfile(updated);
		this.profiles = this.profiles.map((entry) => (entry.id === id ? updated : entry));
		if (updated.syncKey) {
			if (id === this.activeId) await this.queueOutbox([PROFILE_META_KEY]);
			else {
				await markSyncOutbox(id, [PROFILE_META_KEY]);
				this.onWorkspaceOwes?.(id);
			}
		}
		return updated;
	}

	/**
	 * Remove a non-active workspace together with its dataset on this device.
	 * `pending` means another window is holding its database open: the delete
	 * cannot be called off, and the workspace leaves the list when it lands.
	 */
	async removeProfile(id: string): Promise<'removed' | 'pending' | 'failed'> {
		if (this.activeProfile?.id === id) return 'failed';
		if (!this.profiles.some((entry) => entry.id === id)) return 'failed';
		try {
			await removeProfileRecord(id);
		} catch (err) {
			if (err instanceof DeleteBlockedError) {
				void err.completion.then(
					() => this.forgetProfile(id),
					() => undefined
				);
				return 'pending';
			}
			console.error('[sync] could not remove profile:', err);
			return 'failed';
		}
		this.forgetProfile(id);
		return 'removed';
	}

	private forgetProfile(id: string): void {
		this.profiles = this.profiles.filter((entry) => entry.id !== id);
		delete this.states[id];
		try {
			localStorage.removeItem(`${LS_SYNC_STATUS_PREFIX}:${id}`);
		} catch {
			/* status is only a display cache */
		}
	}

	requestAutoSync(keys: Iterable<string> = []): void {
		void this.queueOutbox(keys).catch((err) => {
			console.error('[sync] could not persist outbox:', err);
		});
	}

	async queueOutbox(keys: Iterable<string> = []): Promise<void> {
		const pendingKeys = [...new Set(keys)];
		const pid = this.activeId;
		const write = this.pendingOutboxWrites.then(async () => {
			await markSyncOutbox(pid, pendingKeys);
		});
		this.pendingOutboxWrites = write.catch(() => undefined);
		await write;
		this.onLocalDataChange?.();
	}

	async waitForOutboxWrites(): Promise<void> {
		await this.pendingOutboxWrites;
	}

	private readStatus(pid: string): SyncStatus {
		if (typeof localStorage === 'undefined') return { lastSync: 0 };
		return { lastSync: parseLastSync(localStorage.getItem(`${LS_SYNC_STATUS_PREFIX}:${pid}`)) };
	}

	/** When a workspace last synced is kept across starts; the rest is learned from its next sync. */
	private restoreStatus(pid: string): void {
		const state = this.state(pid);
		// Another window may have synced it since.
		state.lastSync = Math.max(state.lastSync, this.readStatus(pid).lastSync);
	}

	/**
	 * Check which workspaces can be included in a new MCP grant. A synced
	 * workspace is identified by its sync key; authenticating that key against
	 * the relay also prevents stale or deleted cloud accounts from being shown
	 * as selectable. Local sync progress is deliberately not a prerequisite:
	 * MCP reads the encrypted cloud account, so an empty account and a workspace
	 * with local changes waiting to upload are still valid user choices.
	 */
	async getMcpWorkspaceStatuses(): Promise<Record<string, McpWorkspaceStatus>> {
		await this.ensureProfilesLoaded();
		const statuses: Record<string, McpWorkspaceStatus> = {};
		const candidates: StoredProfile[] = [];

		for (const profile of this.profiles) {
			if (!profile.syncKey) {
				statuses[profile.id] = { state: 'local' };
				continue;
			}
			candidates.push(profile);
		}

		await Promise.all(
			candidates.map(async (profile) => {
				try {
					await this.accessToken(identityFromSyncKey(profile.syncKey));
					statuses[profile.id] = { state: 'ready' };
				} catch {
					statuses[profile.id] = { state: 'unavailable' };
				}
			})
		);

		return statuses;
	}

	private saveStatus(pid: string, lastSync: number): void {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(`${LS_SYNC_STATUS_PREFIX}:${pid}`, JSON.stringify({ lastSync }));
		} catch (err) {
			console.error('[sync] could not save status:', err);
		}
	}

	activateProfile(profile: StoredProfile): void {
		if (!profile.syncKey) {
			this.activateLocalWorkspace(profile.id);
			return;
		}
		// Opening a workspace changes nothing about its sync: what its last sync
		// recorded is shown as it is, and its sign-in stays good.
		this.activeId = profile.id;
		this.account = identityFromSyncKey(profile.syncKey);
		this.onAccountChange?.();
		const keys = syncControlKeys(this.account.accountId);
		void getSyncState<number>(profile.id, keys.cursor).then((cursor) => {
			if (typeof cursor === 'number') this.state(profile.id, profile.syncKey).syncedCursor = cursor;
		});
		setLastActiveProfileId(profile.id);
		this.restoreStatus(profile.id);
	}

	/** Activate a local-only namespace without removing any saved sync keys. */
	activateLocalWorkspace(id: string): void {
		this.account = null;
		this.activeId = id;
		setLastActiveProfileId(id);
		this.restoreStatus(id);
		this.onAccountChange?.();
	}

	/** The app's server setting moved: its sessions and live connection were the old server's. */
	serverChanged(): void {
		this.authenticationGeneration += 1;
		this.pendingSessions.clear();
		this.sessions.clear();
		// What was learned of each workspace's sync was the old server's too.
		this.states = {};
		this.onAccountChange?.();
	}

	/**
	 * Sign a workspace in afresh, recreating its relay account when it is missing.
	 * Aborting `signal` gives it up, and so does a relay that goes silent: what runs
	 * it holds the workspace's sync lock meanwhile.
	 */
	async reauthenticateForRecovery(
		profile: StoredProfile,
		turnstileToken?: string,
		signal?: AbortSignal
	): Promise<void> {
		if (!profile.syncKey) throw new Error('That workspace is not synced');
		const account = identityFromSyncKey(profile.syncKey);
		// Only this account starts over: a sign-in under way for another workspace is its own.
		this.sessions.delete(account.accountId);
		this.pendingSessions.delete(account.accountId);
		try {
			await untilAborted(this.accessToken(account), signal);
			return;
		} catch (error) {
			if (signal?.aborted) throw error;
			// A missing relay account can only be recreated during explicit recovery.
		}
		// Explicit recovery may recreate a missing relay account with the same signed identity.
		const response = await withinTime(RELAY_SILENCE_MS, signal ?? null, (limited) =>
			fetch(serverUrl('/api/sync/register'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					accountId: account.accountId,
					authPublicKey: account.authPublicKey,
					signature: signSyncRegistration(
						account.syncKey,
						account.accountId,
						account.authPublicKey
					),
					turnstileToken
				}),
				signal: limited
			})
		);
		if (!response.ok && response.status !== 409) {
			const data = await response.json().catch(() => ({}));
			if (response.status === 410 && data.retired === true) throw this.retired(account);
			throw new Error(
				typeof data.error === 'string' ? data.error : 'Could not recover sync authentication'
			);
		}
		await untilAborted(this.accessToken(account), signal);
	}

	/**
	 * Register a new, empty account with the relay, for a workspace about to get a
	 * new key. Only the relay is asked: nothing on this device changes until
	 * `assignKey`, so this is done without holding anything a workspace change waits for.
	 */
	async registerAccount(
		turnstileToken?: string
	): Promise<{ success: boolean; account?: SyncAccount; error?: string }> {
		const account = createSyncIdentity();
		try {
			const res = await withinTime(RELAY_SILENCE_MS, null, (signal) =>
				fetch(serverUrl('/api/sync/register'), {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						accountId: account.accountId,
						authPublicKey: account.authPublicKey,
						signature: signSyncRegistration(
							account.syncKey,
							account.accountId,
							account.authPublicKey
						),
						turnstileToken
					}),
					signal
				})
			);
			const data = await res.json().catch(() => ({}));
			if (!res.ok)
				return {
					success: false,
					error: typeof data.error === 'string' ? data.error : 'Registration failed'
				};
			return { success: true, account };
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : 'Network error' };
		}
	}

	/**
	 * Put a workspace on the key of an account the relay has registered. Its id,
	 * notes and row stay the same and the next sync uploads them. A key it had
	 * before was retired: that account no longer exists, so its sync state is dropped.
	 */
	async assignKey(
		workspace: StoredProfile,
		account: SyncAccount,
		name?: string
	): Promise<StoredProfile> {
		const profile: StoredProfile = {
			...workspace,
			name: name?.trim() || workspace.name,
			syncKey: account.syncKey
		};
		await this.replaceKeyringEntry(profile);
		if (workspace.syncKey) {
			await this.clearAccountControlPlane(
				identityFromSyncKey(workspace.syncKey).accountId,
				workspace.id
			);
		}
		return profile;
	}

	private async replaceKeyringEntry(profile: StoredProfile): Promise<void> {
		const previous = this.profiles.find((entry) => entry.id === profile.id);
		if (previous && previous.syncKey !== profile.syncKey && typeof localStorage !== 'undefined') {
			try {
				localStorage.removeItem(`${LS_SYNC_STATUS_PREFIX}:${profile.id}`);
			} catch {
				/* status is only a display cache */
			}
		}
		await saveProfile(profile);
		this.profiles = this.profiles.map((entry) => (entry.id === profile.id ? profile : entry));
	}

	async startDeviceLink(
		input: string
	): Promise<{ success: boolean; link?: StartedDeviceLink; error?: string }> {
		return this.startRendezvous(PairingRole.New, input);
	}

	async startExistingDeviceLink(): Promise<{
		success: boolean;
		link?: StartedDeviceLink;
		error?: string;
	}> {
		if (!this.account) return { success: false, error: 'Sync is not set up on this device' };
		return this.startRendezvous(PairingRole.Existing, createOneTimePairingCode());
	}

	private async startRendezvous(
		role: PairingRole,
		input: string
	): Promise<{ success: boolean; link?: StartedDeviceLink; error?: string }> {
		try {
			const requestKey = createPairingRequestKey(input);
			const res = await fetch(serverUrl('/api/sync/pair/start'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ codeTag: pairingCodeTag(input), role, publicKey: requestKey.share })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok || typeof data.id !== 'string' || typeof data.expiresAt !== 'number')
				return {
					success: false,
					error: typeof data.error === 'string' ? data.error : 'Could not start device rendezvous'
				};
			return {
				success: true,
				link: { id: data.id, expiresAt: data.expiresAt, role, syncCode: input, pake: requestKey }
			};
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Could not start device rendezvous'
			};
		}
	}

	async pollDeviceLink(link: StartedDeviceLink): Promise<{
		success: boolean;
		linked?: boolean;
		matched?: boolean;
		expired?: boolean;
		receivedSyncKey?: string;
		error?: string;
	}> {
		try {
			const res = await fetch(serverUrl('/api/sync/pair/poll'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId: link.id })
			});
			const data = (await res.json().catch(() => ({}))) as Partial<PairingPoll>;
			if (!res.ok) return { success: false, error: 'Could not check device rendezvous' };
			if (data.state === PairingState.Waiting) return { success: true };
			if (data.state === PairingState.Expired || data.state === PairingState.NotFound)
				return { success: true, expired: true };
			if (data.state === PairingState.Matched && typeof data.peerPublicKey === 'string') {
				if (link.role === PairingRole.New) return { success: true, matched: true };
				if (!this.account) return { success: false, error: 'Sync is not set up on this device' };
				const grant = sealSyncKeyForPeer(
					this.account.syncKey,
					link.syncCode,
					link.pake,
					data.peerPublicKey
				);
				const sent = await fetch(serverUrl('/api/sync/pair/approve'), {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ sessionId: link.id, grant })
				});
				return sent.ok
					? { success: true, linked: true }
					: { success: false, error: 'Could not deliver encrypted sync key' };
			}
			if (data.state !== PairingState.Connected || !data.grant || typeof data.grant !== 'object')
				return { success: false, error: 'Invalid device rendezvous response' };
			if (link.role !== PairingRole.New) return { success: true, linked: true };
			const grant = data.grant as { existingPublicKey?: unknown; ciphertext?: unknown };
			if (typeof grant.ciphertext !== 'string')
				return { success: false, error: 'Invalid encrypted sync key' };
			const receivedSyncKey = openSyncKeyFromPeer(
				link.syncCode,
				link.pake,
				data.peerPublicKey ?? '',
				{
					ciphertext: grant.ciphertext
				}
			);
			return { success: true, linked: true, receivedSyncKey };
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Could not complete device rendezvous'
			};
		}
	}

	private async accessToken(account: SyncAccount | null = this.account): Promise<string> {
		if (!account) throw new Error('Sync is not set up on this device');
		const session = this.sessions.get(account.accountId);
		if (session && session.expiresAt - Date.now() > 5_000) return session.accessToken;
		const pendingSession = this.pendingSessions.get(account.accountId);
		if (pendingSession) return pendingSession;
		const generation = this.authenticationGeneration;
		// Every sync starts here, so a sign-in the relay never answers is given up too.
		const sessionRequest = withinTime(RELAY_SILENCE_MS, null, async (signal) => {
			const challengeResponse = await fetch(serverUrl('/api/sync/auth/challenge'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ accountId: account.accountId }),
				signal
			});
			const challenge = (await challengeResponse.json().catch(() => ({}))) as {
				challengeId?: unknown;
				challenge?: unknown;
				retired?: unknown;
			};
			if (challengeResponse.status === 410 && challenge.retired === true) {
				throw this.retired(account);
			}
			if (
				!challengeResponse.ok ||
				typeof challenge.challengeId !== 'string' ||
				typeof challenge.challenge !== 'string'
			) {
				throw new Error('Could not start sync authentication');
			}
			const sessionResponse = await fetch(serverUrl('/api/sync/auth/session'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					accountId: account.accountId,
					challengeId: challenge.challengeId,
					signature: signSyncChallenge(account.syncKey, account.accountId, challenge.challenge)
				}),
				signal
			});
			return this.acceptIssuedSession(account, sessionResponse, generation);
		});
		this.pendingSessions.set(account.accountId, sessionRequest);
		try {
			return await sessionRequest;
		} finally {
			if (this.pendingSessions.get(account.accountId) === sessionRequest)
				this.pendingSessions.delete(account.accountId);
		}
	}

	/** Record that the relay refused this key for good, for every workspace on it. */
	private retired(account: SyncAccount): Error {
		for (const profile of this.profiles) {
			if (profile.syncKey === account.syncKey)
				this.state(profile.id, account.syncKey).keyRetired = true;
		}
		return new Error('This sync key was deleted from the cloud. Create a new key to keep syncing.');
	}

	private async acceptIssuedSession(
		account: SyncAccount,
		response: Response,
		generation: number
	): Promise<string> {
		const issued = (await response.json().catch(() => ({}))) as {
			accessToken?: unknown;
			expiresAt?: unknown;
		};
		if (
			!response.ok ||
			typeof issued.accessToken !== 'string' ||
			typeof issued.expiresAt !== 'number'
		) {
			throw new Error('Sync authentication failed');
		}
		// A sign-in that the server before the setting moved answered is not kept.
		if (generation !== this.authenticationGeneration)
			throw new Error('Sync authentication was cancelled');
		this.sessions.set(account.accountId, {
			accessToken: issued.accessToken,
			expiresAt: issued.expiresAt
		});
		return issued.accessToken;
	}

	/** A token for the live change socket, which cannot send the `Authorization` header. */
	async connectionToken(): Promise<{ token: string; refused(): void }> {
		const account = this.account;
		if (!account) throw new Error('Sync is not set up on this device');
		const token = await this.accessToken(account);
		return { token, refused: () => this.invalidateSession(account.accountId, token) };
	}

	private invalidateSession(accountId: string, accessToken: string): void {
		if (this.sessions.get(accountId)?.accessToken === accessToken) this.sessions.delete(accountId);
	}

	/**
	 * Start one history version for a note opened in the editor: every upload until the
	 * returned function ends the session continues that version instead of adding one.
	 */
	beginEditSession(noteId: string): () => void {
		const key = `note:${noteId}`;
		const session = { uploadedId: null };
		this.editSessions.set(key, session);
		return () => {
			if (this.editSessions.get(key) === session) this.editSessions.delete(key);
		};
	}

	/** Attachment ids the note's retained history lists; null when it cannot be read. */
	private async versionAttachmentIds(
		account: SyncAccount,
		note: Note,
		signal?: AbortSignal
	): Promise<Set<string> | null> {
		const key = `${account.accountId}\u0000${note.id}`;
		const cached = this.versionAttachments.get(key);
		if (cached?.updatedAt === note.updatedAt && Date.now() - cached.checkedAt < HISTORY_RECHECK_MS)
			return cached.ids;
		try {
			// Loaded on demand: the history client itself fetches through this store.
			const { loadNoteHistory } = await import('#lib/historyClient.js');
			const versions = await withinTime(RELAY_SILENCE_MS, signal, (limited) =>
				loadNoteHistory(account, note.id, limited)
			);
			const ids = new Set(
				versions.flatMap((version) => (version.note.images ?? []).map((image) => image.id))
			);
			this.versionAttachments.set(key, { updatedAt: note.updatedAt, checkedAt: Date.now(), ids });
			return ids;
		} catch {
			return null;
		}
	}

	async authorizedFetch(
		input: RequestInfo | URL,
		init: RequestInit = {},
		account: SyncAccount | null = this.account
	): Promise<Response> {
		if (!account) throw new Error('Sync is not set up on this device');
		for (let attempt = 0; attempt < 2; attempt += 1) {
			// The caller's signal covers the whole call, the sign-in before the request included.
			const accessToken = await untilAborted(this.accessToken(account), init.signal);
			const headers = new Headers(init.headers);
			headers.set('authorization', `Bearer ${accessToken}`);
			headers.set('x-sync-client-id', this.syncClientId);
			headers.set(SYNC_PROTOCOL_HEADER, SYNC_PROTOCOL_VERSION);
			const response = await fetch(typeof input === 'string' ? serverUrl(input) : input, {
				...init,
				headers
			});
			if (response.status !== 401 || attempt === 1) return response;
			this.invalidateSession(account.accountId, accessToken);
		}
		throw new Error('Sync authentication failed');
	}

	private async sendSyncRequest(
		path: string,
		payload: string,
		uploadBytes: number,
		progress: (progress: SyncProgress) => void,
		account: SyncAccount | null = this.account,
		signal?: AbortSignal,
		// The sync this request is for decides when it is given up.
		cancelled: () => boolean = () => this.account !== account || signal?.aborted === true
	): Promise<SyncResult> {
		if (!account) return { success: false, error: 'Not linked' };
		const live = () => !cancelled();
		for (let attempt = 0; attempt < 2; attempt += 1) {
			// Nothing is asked of the relay, a sign-in included, for a sync already given up.
			if (!live()) return { success: false, error: 'Sync was cancelled' };
			let accessToken: string;
			try {
				accessToken = await untilAborted(this.accessToken(account), signal);
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : 'Authentication failed',
					...(relayNotReached(error) ? { unreachable: true } : {})
				};
			}
			// A delta round is idempotent: an upload the relay already stored carries
			// the same envelope id when it is sent again, which is not a conflict.
			const result = await retryTransient(
				() =>
					live()
						? this.sendSyncRequestWithToken(
								path,
								payload,
								uploadBytes,
								progress,
								accessToken,
								signal
							)
						: Promise.resolve({ success: false, error: 'Sync was cancelled' }),
				(response) => response.transient === true && live(),
				transientRetry,
				signal
			);
			if (result.status !== 401 || attempt === 1) return result;
			this.invalidateSession(account.accountId, accessToken);
		}
		return { success: false, error: 'Sync authentication failed' };
	}

	private sendSyncRequestWithToken(
		path: string,
		payload: string,
		uploadBytes: number,
		/** Told how far a large transfer has come. */
		progress: (progress: SyncProgress) => void,
		accessToken: string,
		signal?: AbortSignal
	): Promise<SyncResult> {
		return new Promise((resolve) => {
			const xhr = new XMLHttpRequest();
			// A sync that gives up its round drops the request instead of waiting it out.
			const dropped = () => xhr.abort();
			signal?.addEventListener('abort', dropped, { once: true });
			xhr.onloadend = () => signal?.removeEventListener('abort', dropped);
			// A connection that is up in name only neither answers nor fails. A request
			// with no byte moving either way for this long is given up. That is the only
			// limit: one that is slow but moving is left to finish, however long a photo
			// takes on a weak signal, since given up it would start again from nothing.
			// What it carried is still queued.
			let silence: ReturnType<typeof setTimeout> | undefined;
			let stalled = false;
			const moving = () => {
				clearTimeout(silence);
				silence = setTimeout(() => {
					stalled = true;
					xhr.abort();
				}, RELAY_SILENCE_MS);
			};
			const settle = (result: SyncResult) => {
				clearTimeout(silence);
				resolve(result);
			};
			xhr.onreadystatechange = moving;
			xhr.open('POST', serverUrl(path));
			xhr.setRequestHeader('Content-Type', 'application/json');
			xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
			xhr.setRequestHeader('x-sync-client-id', this.syncClientId);
			xhr.setRequestHeader(SYNC_PROTOCOL_HEADER, SYNC_PROTOCOL_VERSION);

			const large = uploadBytes >= 32 * 1024;
			if (large) progress({ phase: 'upload', loadedBytes: 0, totalBytes: uploadBytes });
			xhr.upload.onprogress = (event) => {
				moving();
				if (!large) return;
				progress({
					phase: 'upload',
					loadedBytes: event.loaded,
					totalBytes: event.lengthComputable ? event.total : uploadBytes
				});
			};
			xhr.onprogress = (event) => {
				moving();
				if (!event.lengthComputable || event.total < 32 * 1024) return;
				progress({ phase: 'download', loadedBytes: event.loaded, totalBytes: event.total });
			};

			let sentAt = 0;
			xhr.onload = () => {
				const receivedAt = Date.now();
				let data: Record<string, unknown> = {};
				try {
					data = JSON.parse(xhr.responseText || '{}') as Record<string, unknown>;
				} catch {
					/* handled below */
				}
				if (xhr.status < 200 || xhr.status >= 300) {
					const header = xhr.getResponseHeader('retry-after');
					const retryAfter = header === null ? NaN : Number(header);
					const throttled =
						(xhr.status === 429 || xhr.status === 503) &&
						Number.isFinite(retryAfter) &&
						retryAfter >= 0;
					// Background sync can finish while text or a canvas is still unsaved.
					// Keep the document open: reloading also cannot fix an older relay or
					// guarantee a different build from the service worker's cached shell.
					const versionMismatch =
						xhr.status === 409 &&
						typeof data.requiredVersion === 'string' &&
						data.requiredVersion !== SYNC_PROTOCOL_VERSION;
					settle({
						success: false,
						status: xhr.status,
						error: versionMismatch
							? SYNC_VERSION_MISMATCH_MESSAGE
							: xhr.status === 404 && path === SYNC_DELTA_PATH
								? 'The sync server needs an update to support this app version.'
								: typeof data.error === 'string'
									? data.error
									: `Sync request failed (${xhr.status})`,
						...(throttled ? { retryAfterSeconds: retryAfter } : {}),
						// A relay that asks for a wait is waited for by the sync loop instead.
						...(!throttled && xhr.status >= 502 && xhr.status <= 504 ? { transient: true } : {}),
						...(xhr.status >= 500 ? { unreachable: true } : {})
					});
					return;
				}
				// Only the relay's own answer sets the clock; an error page is anyone's.
				observeRelayTime(data.serverTime, sentAt, receivedAt);
				settle({ success: true, data });
			};
			xhr.onerror = () =>
				settle({ success: false, error: 'Sync network error', transient: true, unreachable: true });
			xhr.onabort = () =>
				settle(
					stalled
						? { success: false, error: SYNC_TIMED_OUT, unreachable: true }
						: { success: false, error: 'Sync was cancelled' }
				);
			sentAt = Date.now();
			moving();
			xhr.send(payload);
		});
	}

	/** Adopt a name received from this account's encrypted profile record, for the workspace that synced it. */
	private applySyncedProfileName(name: string, pid: string): void {
		const trimmed = name.trim().slice(0, 60);
		const profile = this.profiles.find((entry) => entry.id === pid);
		if (!profile || !trimmed || profile.name === trimmed) return;
		const updated = { ...profile, name: trimmed };
		this.profiles = this.profiles.map((entry) => (entry.id === profile.id ? updated : entry));
		void saveProfile(updated).catch((err) =>
			console.error('[sync] could not store the synced profile name:', err)
		);
	}

	/**
	 * Read everything the relay holds for a workspace, sending nothing. It starts
	 * from the beginning whatever this device has synced before, and nothing on this
	 * device records that it was read: `snapshot` is the relay's copy, and `control`
	 * the sync state of a device holding exactly that. For an operation that rewrites
	 * the workspace from the relay's copy and commits both in one step.
	 */
	readRelay(profile: StoredProfile, signal: AbortSignal): Promise<SyncResult> {
		if (!profile.syncKey) return Promise.resolve({ success: false, error: 'Not linked' });
		return this.syncTarget(
			{ account: identityFromSyncKey(profile.syncKey), pid: profile.id },
			syncSnapshot(),
			true,
			undefined,
			signal
		);
	}

	/**
	 * Sync a workspace with the relay, whichever workspace this window shows. `local`
	 * is what its database holds and `applyPulled` saves there. Progress, usage and
	 * errors are recorded for that workspace, and shown while it is the open one.
	 */
	syncWorkspace(
		profile: StoredProfile,
		local: SyncSnapshot,
		applyPulled: ApplyPulled,
		signal: AbortSignal
	): Promise<SyncResult> {
		if (!profile.syncKey) return Promise.resolve({ success: false, error: 'Not linked' });
		return this.syncTarget(
			{ account: identityFromSyncKey(profile.syncKey), pid: profile.id },
			local,
			false,
			applyPulled,
			signal
		);
	}

	/** True while this device holds `pid` under this key. */
	private holds(pid: string, account: SyncAccount): boolean {
		return (
			!isProfileReleased(pid) &&
			this.profiles.some((entry) => entry.id === pid && entry.syncKey === account.syncKey)
		);
	}

	/** Photos this device could not read were left out of a sync that otherwise settled. */
	attachmentsUnreadable(pid: string, some: boolean): void {
		const state = this.state(pid);
		if (some) state.lastError = UNREADABLE_ATTACHMENTS;
		else if (state.lastError === UNREADABLE_ATTACHMENTS) state.lastError = null;
	}

	/** End-to-end encrypted per-record delta. Uploads only dirty outbox keys. */
	private async syncTarget(
		{ account, pid }: SyncTarget,
		local: SyncSnapshot,
		/** Only read the relay's copy: see `readRelay`. */
		read: boolean,
		applyPulled?: ApplyPulled,
		signal?: AbortSignal
	): Promise<SyncResult> {
		// Aborting `signal` ends the sync at its next step without waiting on the relay.
		// What it had not committed stays queued, and the next sync sends or reads it again.
		// So does taking the workspace, or its key, off this device.
		const syncCancelled = (): boolean => signal?.aborted === true || !this.holds(pid, account);
		// What this sync learns is recorded for its workspace, while it is on this key.
		const record = (): WorkspaceSyncState => this.state(pid, account.syncKey);
		let bootstrap = false;
		try {
			const ATTACHMENT_UPLOAD_BUDGET = 2;
			// A large page is bounded by the relay's own byte cap, so notes pull
			// tens at once while photos keep their own rounds small.
			const DOWNLOAD_LIMIT = 50;
			const MAX_RESET_RETRIES = 3;
			const MAX_THROTTLED_WAITS = 5;
			let resetRetries = 0;
			let throttledWaits = 0;
			const quotaBlockedKeys = new Set<string>();
			let quotaSingleUpload = false;
			const keys = syncControlKeys(account.accountId);
			// A read starts from nothing: what this device has synced before is not its business.
			const stored = <T>(key: string): Promise<T | undefined> =>
				read ? Promise.resolve(undefined) : getSyncState<T>(pid, key).catch(() => undefined);
			let baseline: Record<string, string> = {};
			const durable = await stored<unknown>(keys.baseline);
			if (durable && typeof durable === 'object' && !Array.isArray(durable))
				baseline = Object.fromEntries(
					Object.entries(durable).filter(
						([key, value]) => typeof key === 'string' && typeof value === 'string'
					)
				);
			// What the relay holds of attachments is learned from what this device downloads
			// and uploads. A device without that record starts over and downloads everything.
			const knownRelay = await stored<RelayAttachments>(keys.relayAttachments);
			if (!knownRelay?.versions || !knownRelay.listed) baseline = {};
			const firstFullUpload = Object.keys(baseline).length === 0;
			let relay: RelayAttachments =
				firstFullUpload || !knownRelay ? emptyRelayAttachments() : knownRelay;
			let recordIds = (await stored<Record<string, string>>(keys.recordIds)) ?? {};
			if (!recordIds || typeof recordIds !== 'object' || Array.isArray(recordIds)) recordIds = {};
			// A first upload sends everything over several rounds, and a rewrite of the workspace or a
			// closed tab may cut it short. Queued before it starts, what was not sent
			// yet is sent by the sync after; otherwise only later edits would be.
			if (firstFullUpload && !read) await markSyncOutbox(pid, currentRecordKeys(local));
			const outboxSnapshotAt = await getOutboxGeneration(pid);
			let outboxKeys = new Set(read ? [] : await getSyncOutboxKeys(pid).catch(() => []));
			let cursor = Number((await stored<number>(keys.cursor)) || 0);
			if (firstFullUpload && cursor > 0) cursor = 0;

			let merged: SyncSnapshot = {
				...local,
				tombstones: { ...local.tombstones },
				labelTombstones: { ...local.labelTombstones },
				boardTombstones: { ...local.boardTombstones },
				libraryTombstones: { ...local.libraryTombstones }
			};
			const attachments = new Map<string, NoteImage>();
			for (const note of local.notes) {
				for (const image of note.images ?? []) {
					if (!image.dataUrl?.length) continue;
					const hash = await sha256(image.dataUrl);
					const withHash = { ...image, contentHash: hash };
					attachments.set(attachmentRefKey(image.id, hash), withHash);
					attachments.set(image.id, withHash);
				}
			}

			let hasMore = true;
			let downloadsDrained = false;
			// One history lookup per note version for the whole sync: the plan before a round
			// and the check after it ask the same question, and a lookup that failed is not
			// worth repeating until the next sync.
			const historyLookups = new Map<string, Promise<Set<string> | null>>();
			const historyAttachmentIds = (note: Note) => {
				const key = `${note.id}\u0000${note.updatedAt}`;
				let lookup = historyLookups.get(key);
				if (!lookup) {
					lookup = this.versionAttachmentIds(account, note, signal);
					historyLookups.set(key, lookup);
				}
				return lookup;
			};
			// Deletes a history version still needs wait for a later sync, so they are neither
			// sent nor counted as work that keeps this one going.
			const plannedDeletes = async () =>
				(
					await withoutAttachmentsHistoryNeeds(
						planDeletableKeys({
							recordIds,
							snapshot: merged,
							pullOnly: read,
							catchUpComplete: downloadsDrained
						}),
						merged.notes,
						merged.tombstones,
						historyAttachmentIds
					)
				).filter((key) => key !== PROFILE_META_KEY);
			const acknowledgedOutbox = new Set<string>();
			const uploadedThisSync = new Map<string, string>();
			/** Keep the record of the relay's attachments in step with a record it holds. */
			const sawOnRelay = (payload: SyncRecordPayload): void => {
				if (payload.kind === 'attachment') relay.versions[payload.value.id] = payload.value.hash;
				else if (payload.kind === 'note-tombstone') delete relay.listed[payload.id];
				else if (payload.kind === 'note') {
					// A deleted note's record protects nothing: its attachments may be cleaned up.
					if (Number(merged.tombstones[payload.value.id]) > 0)
						delete relay.listed[payload.value.id];
					else
						relay.listed[payload.value.id] = (payload.value.images ?? []).map((image) => image.id);
				}
			};
			const internallyMarkedOutbox = new Map<string, number>();
			let poisonCount = 0;
			let stalledWrites = 0;
			while (hasMore) {
				if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
				const startedWithDownloadsDrained = downloadsDrained;
				const uploadKeys =
					read || !downloadsDrained ? new Set<string>() : firstFullUpload ? undefined : outboxKeys;
				const currentRecords = await buildSyncRecords(merged, uploadKeys);
				const metaUploadDue =
					!read &&
					downloadsDrained &&
					outboxKeys.has(PROFILE_META_KEY) &&
					!quotaBlockedKeys.has(PROFILE_META_KEY) &&
					(uploadKeys === undefined || uploadKeys.has(PROFILE_META_KEY));
				if (metaUploadDue) {
					const metaPayload = {
						kind: 'profile-meta' as const,
						value: { name: this.profiles.find((entry) => entry.id === pid)?.name ?? '' }
					};
					currentRecords.push({
						key: PROFILE_META_KEY,
						fingerprint: await sha256(metaPayload),
						payload: metaPayload
					});
				}
				// The relay never lists an attachment version it does not hold: a request
				// commits whole, so bytes travel in the same one as the notes that list them,
				// and every note is sent listing only what the relay holds once it commits.
				const uploading = read || !downloadsDrained ? [] : currentRecords;
				const relayHeld = relayHeldVersions(relay);
				const noteRecords = uploading.filter((record) => record.payload.kind === 'note');
				const listsAttachment = (record: SyncRecord, id: string, hash: string): boolean =>
					record.payload.kind === 'note' &&
					(record.payload.value.images ?? []).some(
						(image) => image.id === id && image.hash === hash
					);
				const sendingAttachments: SyncRecord[] = [];
				const carriers: SyncRecord[] = [];
				for (const record of uploading) {
					if (sendingAttachments.length >= (quotaSingleUpload ? 1 : ATTACHMENT_UPLOAD_BUDGET))
						break;
					if (record.payload.kind !== 'attachment' || quotaBlockedKeys.has(record.key)) continue;
					const { id, hash } = record.payload.value;
					if (relayHeld.get(id) === hash) continue;
					// Every note the relay has listing this attachment is rewritten with it, and
					// at least one note lists the new version: none may be left naming bytes
					// the relay has replaced.
					const listing = noteRecords.filter((note) => listsAttachment(note, id, hash));
					const listedOnRelay = Object.entries(relay.listed)
						.filter(([, ids]) => ids.includes(id))
						.map(([noteId]) => `note:${noteId}`);
					const rewritten = noteRecords.filter((note) => listedOnRelay.includes(note.key));
					const needed = [...new Set([...listing.slice(0, 1), ...rewritten])];
					const together = new Set([...carriers, ...needed]).size + sendingAttachments.length + 1;
					if (
						listing.length === 0 ||
						rewritten.length < listedOnRelay.length ||
						needed.some((note) => quotaBlockedKeys.has(note.key)) ||
						together > MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST
					)
						continue;
					sendingAttachments.push(record);
					for (const note of needed) if (!carriers.includes(note)) carriers.push(note);
				}
				const heldAfter = new Map(relayHeld);
				for (const record of sendingAttachments) {
					if (record.payload.kind === 'attachment')
						heldAfter.set(record.payload.value.id, record.payload.value.hash);
				}
				const forRelay = (record: SyncRecord) => noteRecordForRelay(record, heldAfter);
				const changed = (
					await Promise.all(
						uploading
							.filter((record) => record.payload.kind !== 'attachment')
							.map(async (record) => ({ local: record, sent: await forRelay(record) }))
					)
				).filter(
					// A note the relay already holds as it would be sent needs no sending.
					({ sent }) => !quotaBlockedKeys.has(sent.key) && baseline[sent.key] !== sent.fingerprint
				);
				// The notes an attachment travels with go first, so the request holds them.
				const first = changed.filter(({ local }) => carriers.includes(local));
				const rest = changed.filter(({ local }) => !carriers.includes(local));
				// Under quota pressure a round sends the least that commits alone: one
				// attachment with its notes, or one other record.
				const outgoing: SyncRecord[] = quotaSingleUpload
					? sendingAttachments.length
						? [...sendingAttachments, ...first.map(({ sent }) => sent)]
						: rest.slice(0, 1).map(({ sent }) => sent)
					: [...sendingAttachments, ...[...first, ...rest].map(({ sent }) => sent)].slice(
							0,
							MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST
						);
				// Attachments past this round's budget go in the next one, once this one is in.
				const dueAttachments = uploading.filter(
					(record) =>
						record.payload.kind === 'attachment' &&
						!quotaBlockedKeys.has(record.key) &&
						relayHeld.get(record.payload.value.id) !== record.payload.value.hash
				).length;
				const uploadsLeft =
					outgoing.length > 0 ? dueAttachments + changed.length - outgoing.length : 0;
				const sentRecordKeys = new Set(outgoing.map((record) => record.key));
				const sentIds = new Set<string>();
				const sentRecordIds = new Map<string, string>();
				const sentSlots = new Map<string, string>();
				const outbound = await Promise.all(
					outgoing.map(async (record: SyncRecord) => {
						const id = randomOpaqueId();
						sentIds.add(id);
						sentRecordIds.set(record.key, id);
						// Keyed, non-reversible slot token: relay can replace old ciphertext but cannot
						// infer whether this is a note, attachment, board, or its plaintext identity.
						const slot = await sha256(`${account.syncKey}\u0000${record.key}`);
						sentSlots.set(slot, record.key);
						const expectedId = recordIds[record.key] ?? null;
						// Only a version this editing session uploaded is continued; one another
						// device or an earlier session wrote stays in the history.
						// So is a note this sync sent a moment ago with fewer attachments listed:
						// the two are one version, arriving in steps.
						const uploadedId =
							this.editSessions.get(record.key)?.uploadedId ?? uploadedThisSync.get(record.key);
						return {
							id,
							slot,
							expectedId,
							...(uploadedId && uploadedId === expectedId ? { continues: true } : {}),
							ciphertext: encryptSyncPayload(account.syncKey, record.payload, slot)
						};
					})
				);
				const currentKeys = currentRecordKeys(merged);
				if (recordIds[PROFILE_META_KEY] || sentRecordIds.has(PROFILE_META_KEY) || metaUploadDue)
					currentKeys.add(PROFILE_META_KEY);
				// Slot tokens are keyed hashes of record keys, so an unreadable envelope can
				// still be identified locally. Adopting its id lets a later upload replace
				// it or a delete reclaim it instead of stranding the slot on the relay;
				// keys this device already tracks keep their existing mapping.
				let knownSlotMap: Promise<Map<string, string>> | null = null;
				const knownSlotKey = async (slot: string): Promise<string | undefined> => {
					const sentKey = sentSlots.get(slot);
					if (sentKey) return sentKey;
					knownSlotMap ??= Promise.all(
						[...new Set([...Object.keys(recordIds), ...currentKeys])].map(
							async (key) => [await sha256(`${account.syncKey}\u0000${key}`), key] as const
						)
					).then((entries) => new Map(entries));
					return (await knownSlotMap).get(slot);
				};
				const deletableKeys = (await plannedDeletes()).slice(
					0,
					MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST - outbound.length
				);
				const deleteSlots = await Promise.all(
					deletableKeys.map(async (key) => ({
						id: recordIds[key],
						slot: await sha256(`${account.syncKey}\u0000${key}`)
					}))
				);
				const payload = JSON.stringify({
					cursor,
					limit: DOWNLOAD_LIMIT,
					envelopes: outbound,
					deleteSlots
				});
				const response = await this.sendSyncRequest(
					SYNC_DELTA_PATH,
					payload,
					new Blob([payload]).size,
					(progress) => (record().progress = progress),
					account,
					signal,
					syncCancelled
				);
				if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
				if (!response.success && response.status === 507 && outgoing.length > 0) {
					if (!quotaSingleUpload && outgoing.length > 1) quotaSingleUpload = true;
					else {
						const blockedKey = outgoing[0].key;
						quotaBlockedKeys.add(blockedKey);
						await markSyncOutbox(pid, [blockedKey]);
						outboxKeys.add(blockedKey);
						quotaSingleUpload = false;
					}
					hasMore = true;
					continue;
				}
				// A large sync can outrun the relay's per-minute budget. Nothing was written,
				// so it waits as long as the relay asks and sends the round again.
				if (
					!response.success &&
					response.retryAfterSeconds !== undefined &&
					throttledWaits < MAX_THROTTLED_WAITS
				) {
					throttledWaits += 1;
					await wait(Math.min(response.retryAfterSeconds, 30) * 1000, signal);
					continue;
				}
				if (!response.success || !response.data) return this.fail(response, record());
				throttledWaits = 0;
				const remoteUsage = response.data.usage;
				if (remoteUsage && typeof remoteUsage === 'object') {
					const candidate = remoteUsage as Partial<SyncUsage>;
					if (
						[
							candidate.ciphertextBytes,
							candidate.envelopeCount,
							candidate.storageBytes,
							candidate.maxBytes
						].every((value) => typeof value === 'number' && Number.isFinite(value))
					) {
						record().usage = candidate as SyncUsage;
					}
				}
				const writesAccepted = response.data.writesAccepted === true;
				const conflicts = Array.isArray(response.data.conflicts) ? response.data.conflicts : [];
				// A conflict response returns only conflicting slots, but its cursor may
				// include unrelated writes. Catch those up before retrying the upload.
				const conflictNeedsCatchUp = !writesAccepted && conflicts.length > 0;
				if (writesAccepted) {
					if (outgoing.length > 0 || deleteSlots.length > 0) stalledWrites = 0;
					for (const key of deletableKeys) {
						delete recordIds[key];
						if (key.startsWith('attachment:')) delete relay.versions[key.slice(11)];
						if (key.startsWith('note:')) delete relay.listed[key.slice(5)];
					}
					for (const record of outgoing) sawOnRelay(record.payload);
					for (const [key, id] of sentRecordIds) {
						recordIds[key] = id;
						uploadedThisSync.set(key, id);
						const session = this.editSessions.get(key);
						if (session) session.uploadedId = id;
					}
					for (const key of deletableKeys) acknowledgedOutbox.add(key);
				}
				if (response.data.reset === true) {
					// The relay was deliberately reset while this device retained a baseline.
					// The caller sends this device's whole copy, attachments included, next.
					resetRetries += 1;
					if (resetRetries > MAX_RESET_RETRIES)
						throw new Error('Relay repeatedly requested a state reset');
					bootstrap = true;
					baseline = {};
					recordIds = {};
					relay = emptyRelayAttachments();
					cursor = 0;
					continue;
				}

				const pendingNotes: Note[] = [];
				const remoteFingerprints: Record<string, string> = {};
				let decodedAny = false;
				let adoptedConflictId = false;
				const applyPayload = (record: SyncRecordPayload) => {
					sawOnRelay(record);
					switch (record.kind) {
						case 'attachment': {
							const image = attachmentToImage(record.value);
							attachments.set(attachmentRefKey(record.value.id, record.value.hash), image);
							attachments.set(record.value.id, image);
							break;
						}
						case 'note':
							pendingNotes.push(hydrateNoteImages(record.value, attachments));
							break;
						case 'label':
							merged.labels = mergeLabelLists(merged.labels, [record.value]);
							break;
						case 'board':
							merged.boards = mergeKanbanBoards(
								merged.boards,
								[record.value],
								merged.boardTombstones
							);
							break;
						case 'library-item':
							merged.libraryItems = mergeCanvasLibrary(
								merged.libraryItems,
								[record.value],
								merged.libraryTombstones
							);
							break;
						case 'note-tombstone':
							merged.tombstones = mergeTombstoneMaps(merged.tombstones, {
								[record.id]: record.deletedAt
							});
							break;
						case 'label-tombstone':
							merged.labelTombstones = mergeTombstoneMaps(merged.labelTombstones, {
								[record.id]: record.deletedAt
							});
							break;
						case 'board-tombstone':
							merged.boardTombstones = mergeTombstoneMaps(merged.boardTombstones, {
								[record.id]: record.deletedAt
							});
							break;
						case 'library-item-tombstone':
							merged.libraryTombstones = mergeTombstoneMaps(merged.libraryTombstones, {
								[record.id]: record.deletedAt
							});
							break;
						case 'profile-meta':
							// A read changes nothing on this device, the workspace's name included.
							if (
								!read &&
								typeof (record as { value?: { name?: unknown } }).value?.name === 'string'
							)
								this.applySyncedProfileName(
									(record as { value: { name: string } }).value.name,
									pid
								);
							break;
					}
				};
				const downloaded = Array.isArray(response.data.envelopes) ? response.data.envelopes : [];
				const envelopes = [...downloaded, ...conflicts];
				for (const envelope of envelopes) {
					if (!envelope || typeof envelope !== 'object') {
						poisonCount += 1;
						continue;
					}
					const id =
						typeof (envelope as { id?: unknown }).id === 'string'
							? (envelope as { id: string }).id
							: '';
					const slot =
						typeof (envelope as { slot?: unknown }).slot === 'string'
							? (envelope as { slot: string }).slot
							: '';
					if (id && sentIds.has(id)) continue;
					if (typeof (envelope as { ciphertext?: unknown }).ciphertext !== 'string') {
						poisonCount += 1;
						continue;
					}
					let decodedRecords: SyncRecordPayload[] | null = null;
					try {
						const payload = decryptSyncPayload(
							account.syncKey,
							(envelope as { ciphertext: string }).ciphertext,
							slot
						);
						decodedRecords = isSyncRecordPayload(payload) ? [payload] : null;
					} catch {
						decodedRecords = null;
					}
					if (!decodedRecords) {
						poisonCount += 1;
						const key = slot ? await knownSlotKey(slot) : undefined;
						if (key && id && (sentSlots.has(slot) || !recordIds[key])) {
							recordIds[key] = id;
							adoptedConflictId = true;
						}
						continue;
					}
					decodedAny = true;
					const ordered = [
						...decodedRecords.filter((record) => record.kind === 'attachment'),
						...decodedRecords.filter((record) => record.kind !== 'attachment')
					];
					for (const record of ordered) {
						applyPayload(record);
						const key = syncRecordKey(record);
						recordIds[key] = id;
						remoteFingerprints[key] = await sha256(record);
						currentKeys.add(key);
					}
				}
				if (!writesAccepted && (outgoing.length > 0 || deleteSlots.length > 0)) {
					if (decodedAny || adoptedConflictId || downloaded.length > 0) {
						stalledWrites = 0;
					} else {
						stalledWrites += 1;
						if (stalledWrites >= 3) {
							throw new Error('Could not commit encrypted writes after repeated conflicts');
						}
					}
				}
				if (pendingNotes.length) {
					merged.notes = mergeNoteLists(
						merged.notes,
						pendingNotes.map((note) => hydrateNoteImages(note, attachments))
					);
				}
				merged.notes = merged.notes.map((note) => hydrateNoteImages(note, attachments));

				if (typeof response.data.cursor === 'number' && !conflictNeedsCatchUp) {
					cursor = response.data.cursor;
				}
				downloadsDrained = !conflictNeedsCatchUp && response.data.hasMore !== true;

				merged.notes = withoutTombstoned(merged.notes, merged.tombstones);
				merged.labels = withoutTombstoned(merged.labels, merged.labelTombstones);
				merged.boards = withoutTombstoned(merged.boards, merged.boardTombstones);
				merged.libraryItems = mergeCanvasLibrary([], merged.libraryItems, merged.libraryTombstones);
				if (
					downloadsDrained &&
					(!startedWithDownloadsDrained || envelopes.length > 0) &&
					applyPulled
				) {
					if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
					merged = await applyPulled(merged, pid, {
						relayHolds: (id, hash) => relayHeldVersions(relay).get(id) === hash,
						relayHas: (id, hash) => {
							if (hash === null) delete relay.versions[id];
							else relay.versions[id] = hash;
						},
						owes: async (owed) => {
							const generation = await markSyncOutbox(pid, owed);
							for (const key of owed) {
								outboxKeys.add(key);
								internallyMarkedOutbox.set(key, generation);
							}
						}
					});
					for (const note of merged.notes) {
						for (const image of note.images ?? []) {
							if (!image.dataUrl?.length) continue;
							const hash = await sha256(image.dataUrl);
							const withHash = { ...image, contentHash: hash };
							attachments.set(attachmentRefKey(image.id, hash), withHash);
							attachments.set(image.id, withHash);
						}
					}
				}
				if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
				const mergedRecords = await buildSyncRecords(
					merged,
					new Set([...sentRecordKeys, ...Object.keys(remoteFingerprints), ...outboxKeys])
				);
				const uploadedFingerprints = writesAccepted
					? Object.fromEntries(outgoing.map((record) => [record.key, record.fingerprint]))
					: {};
				const mergedFingerprints = fingerprintMapFrom(mergedRecords);
				const reconciled = reconcileBaseline({
					previous: baseline,
					uploaded: uploadedFingerprints,
					remote: remoteFingerprints,
					merged: mergedFingerprints,
					currentKeys: currentRecordKeys(merged),
					referencedAttachments: referencedAttachmentIds(merged.notes, merged.tombstones),
					catchUpComplete: downloadsDrained
				});
				baseline = reconciled.baseline;
				for (const key of reconciled.ackKeys) acknowledgedOutbox.add(key);
				if (reconciled.dirtyKeys.length && !read) {
					const generation = await markSyncOutbox(pid, reconciled.dirtyKeys);
					for (const key of reconciled.dirtyKeys) {
						outboxKeys.add(key);
						internallyMarkedOutbox.set(key, generation);
					}
				}

				if (downloadsDrained) {
					const heldNow = relayHeldVersions(relay);
					const listedHere = new Map<string, string[]>();
					for (const record of mergedRecords) {
						if (record.payload.kind !== 'note') continue;
						for (const image of record.payload.value.images ?? []) {
							listedHere.set(image.id, [...(listedHere.get(image.id) ?? []), image.hash]);
						}
					}
					for (const key of outboxKeys) {
						if (!currentKeys.has(key)) {
							acknowledgedOutbox.add(key);
						} else if (
							// An attachment the relay holds in every version listed here has
							// nothing left to send, whether or not its bytes were loaded.
							key.startsWith('attachment:') &&
							(listedHere.get(key.slice(11)) ?? []).every(
								(hash) => heldNow.get(key.slice(11)) === hash
							)
						) {
							acknowledgedOutbox.add(key);
						} else if (
							// Queued, but the relay already holds it as it is (pinned and unpinned
							// before a sync, say): nothing is left to send.
							recordIds[key] &&
							mergedFingerprints[key] !== undefined &&
							mergedFingerprints[key] === baseline[key]
						) {
							acknowledgedOutbox.add(key);
						}
					}
					const internalAcknowledgements = new Map<number, string[]>();
					for (const key of acknowledgedOutbox) {
						const markedAt = internallyMarkedOutbox.get(key);
						if (markedAt == null) continue;
						const keysAtGeneration = internalAcknowledgements.get(markedAt) ?? [];
						keysAtGeneration.push(key);
						internalAcknowledgements.set(markedAt, keysAtGeneration);
					}
					if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
					if (!read) {
						await commitSyncControl(
							pid,
							[
								[keys.cursor, cursor],
								[keys.baseline, baseline],
								[keys.recordIds, recordIds],
								[keys.relayAttachments, relay]
							],
							[
								{ keys: acknowledgedOutbox, through: outboxSnapshotAt },
								...[...internalAcknowledgements].map(([markedAt, keysAtGeneration]) => ({
									keys: keysAtGeneration,
									through: markedAt
								}))
							]
						);
						record().syncedCursor = cursor;
					}
					for (const keysAtGeneration of internalAcknowledgements.values()) {
						for (const key of keysAtGeneration) internallyMarkedOutbox.delete(key);
					}
				}

				const pendingOutboxUpload = [...outboxKeys].some(
					(key) => !acknowledgedOutbox.has(key) && !quotaBlockedKeys.has(key)
				);
				const remainingUploads =
					!read &&
					((!startedWithDownloadsDrained && (firstFullUpload || pendingOutboxUpload)) ||
						(!writesAccepted && (outgoing.length > 0 || deleteSlots.length > 0)) ||
						uploadsLeft > 0);
				const pendingDeletes = downloadsDrained && (await plannedDeletes()).length > 0;
				hasMore = syncRoundHasMore({
					remoteHasMore: response.data.hasMore === true,
					remainingUploads,
					pendingDeletes
				});
			}

			if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
			if (read)
				return {
					success: true,
					snapshot: merged,
					control: {
						[keys.cursor]: cursor,
						[keys.baseline]: baseline,
						[keys.recordIds]: recordIds,
						[keys.relayAttachments]: relay
					}
				};
			if (quotaBlockedKeys.size > 0 && poisonCount === 0)
				return this.fail(
					{
						success: false,
						error: 'Sync incomplete: account storage quota prevented some uploads',
						refused: true
					},
					record()
				);
			const syncedAt = Date.now();
			const state = record();
			state.lastError =
				poisonCount > 0
					? `Skipped ${poisonCount} unreadable sync record${poisonCount === 1 ? '' : 's'}`
					: null;
			state.lastSync = syncedAt;
			this.saveStatus(pid, syncedAt);
			return { success: true, snapshot: merged, ...(bootstrap ? { bootstrap } : {}) };
		} catch (err) {
			if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
			return this.fail(
				{
					success: false,
					error:
						err instanceof Error
							? `Encrypted sync failed: ${err.message}`
							: 'Encrypted sync failed',
					...(relayNotReached(err) ? { unreachable: true } : {})
				},
				record()
			);
		} finally {
			record().progress = null;
		}
	}

	/** A failed sync's answer, recorded for its workspace. */
	private fail(result: SyncResult, state: WorkspaceSyncState): SyncResult {
		const error = result.error || 'Sync failed';
		state.unreachableError = result.unreachable ? error : null;
		state.lastError = error;
		// The relay's own "no" stands until something changes. A sign-in that expired,
		// a request it gave up on and a request to slow down are not that.
		const refused =
			result.refused === true ||
			(result.status !== undefined &&
				result.status >= 400 &&
				result.status < 500 &&
				![401, 408, 429].includes(result.status));
		return { success: false, error, ...(refused ? { refused } : {}) };
	}

	async committedRevision(): Promise<number | null> {
		if (!this.account) return null;
		const cursor = await getSyncState<number>(
			this.activePid,
			syncControlKeys(this.account.accountId).cursor
		).catch(() => undefined);
		return Number.isSafeInteger(cursor) && Number(cursor) >= 0 ? Number(cursor) : null;
	}

	async clearAccountControlPlane(accountId: string, pid: string = this.activePid): Promise<void> {
		const keys = syncControlKeys(accountId);
		await Promise.all([
			deleteSyncState(pid, keys.cursor),
			deleteSyncState(pid, keys.baseline),
			deleteSyncState(pid, keys.recordIds),
			deleteSyncState(pid, keys.relayAttachments)
		]);
	}

	/**
	 * Stop syncing a workspace on this device. It keeps its id and notes and
	 * becomes a private workspace; the cloud copy is left alone.
	 */
	async unlinkProfile(profile: StoredProfile): Promise<StoredProfile> {
		if (isLocalWorkspace(profile)) return profile;
		const { accountId } = identityFromSyncKey(profile.syncKey);
		const unlinked: StoredProfile = { ...profile, syncKey: '' };
		await this.replaceKeyringEntry(unlinked);
		if (this.activeId === profile.id) this.activateLocalWorkspace(profile.id);
		await this.clearAccountControlPlane(accountId, profile.id);
		const pending = await getSyncOutboxKeys(profile.id).catch(() => []);
		await clearSyncOutbox(profile.id, pending);
		return unlinked;
	}

	/**
	 * Delete a workspace's account from the relay. Only the relay is asked: the
	 * workspace is unlinked on this device afterwards, so nothing a workspace change
	 * waits for is held while the relay takes its time.
	 */
	async deleteRelayAccount(profile: StoredProfile): Promise<{ success: boolean; error?: string }> {
		if (!profile.syncKey) return { success: false, error: 'That workspace is not synced' };
		try {
			const response = await withinTime(RELAY_SILENCE_MS, null, (signal) =>
				this.authorizedFetch(
					'/api/sync/account',
					// Typed, so SvelteKit's form-CSRF check never depends on how a proxy names the host.
					{ method: 'DELETE', headers: { 'content-type': 'application/json' }, signal },
					identityFromSyncKey(profile.syncKey)
				)
			);
			if (!response.ok) {
				const data = (await response.json().catch(() => ({}))) as { error?: unknown };
				return {
					success: false,
					error: typeof data.error === 'string' ? data.error : 'Could not remove from the cloud'
				};
			}
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Network error'
			};
		}
	}
}

export const syncStore = new SyncStore();
export const syncEventsClient = new SyncEventsClient(syncStore, syncStore.syncClientId);
syncStore.onAccountChange = () => syncEventsClient.accountChanged();
