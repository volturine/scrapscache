// Client-side account, sync status, and real transfer progress for full-size photo backups.

import type { Note, NoteImage } from '$lib/types';
import { mergeKanbanBoards } from '$lib/kanban';
import { mergeCanvasLibrary } from '$lib/canvasLibrary';
import { mergeLabelLists, mergeNoteLists, uid, withoutTombstoned } from '$lib/model';
import { observeRelayTime } from '$lib/editContext';
import {
	currentRecordKeys,
	fingerprintMapFrom,
	planDeletableKeys,
	reconcileBaseline,
	referencedAttachmentIds,
	syncRoundHasMore,
	syncControlKeys
} from '$lib/syncEngine';
import { SyncEventsClient } from '$lib/syncEventsClient';
import { withoutAttachmentsHistoryNeeds } from '$lib/attachmentRetention';
import {
	attachmentToImage,
	buildSyncRecords,
	changedRecords,
	hydrateNoteImages,
	isSyncRecordPayload,
	syncRecordKey,
	type SyncRecord,
	type SyncRecordPayload,
	type SyncSnapshot
} from '$lib/syncRecords';
import { MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST } from '$lib/syncLimits';
import { sha256 } from '$lib/syncHash';
import {
	createOneTimePairingCode,
	createPairingRequestKey,
	createSyncIdentity,
	identityFromSyncKey,
	legacyAuthSecret,
	openSyncKeyFromPeer,
	pairingCodeTag,
	sealSyncKeyForPeer,
	signSyncChallenge,
	signSyncMigration,
	signSyncRegistration,
	encryptSyncPayload,
	decryptSyncEnvelope,
	randomOpaqueId
} from '$lib/syncPairing';
import { PairingRole, PairingState, type PairingPoll } from '$lib/pairingProtocol';
import {
	clearSyncOutbox,
	commitSyncControl,
	DeleteBlockedError,
	deleteSyncState,
	getOutboxGeneration,
	getSyncOutboxKeys,
	getSyncState,
	markSyncOutbox,
	setRegisteredWorkspaces
} from '$lib/db/idb';
import { LEGACY_WORKSPACE_ID, moveLegacyWorkspace } from '$lib/workspaceMove';
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
} from '$lib/profiles';

const LS_LEGACY_ACCOUNT_KEY = 'scrapscache-sync-account';
const LS_LEGACY_ACCOUNT_OLD = 'gkc-sync-account';
const LS_SYNC_STATUS_PREFIX = 'scrapscache-sync-status';
const LS_SYNC_STATUS_OLD = 'gkc-sync-status';

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

function isSyncAccount(value: unknown): value is Pick<SyncAccount, 'syncKey'> {
	return !!value && typeof value === 'object' && typeof (value as SyncAccount).syncKey === 'string';
}

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
};

/**
 * Applies what a flight pulled. The workspace is handed over with it: a flight
 * belongs to the workspace it started in, and the window may have moved to
 * another one by the time the bytes are decrypted.
 */
type ApplyPulled = (snapshot: SyncSnapshot, pid: string) => Promise<SyncSnapshot>;

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

export class SyncStore {
	account = $state<SyncAccount | null>(null);
	lastSync = $state(0);
	lastError = $state<string | null>(null);
	/** The active key's cloud data was deleted, so the relay will never accept it
	 * again. The workspace can only keep syncing on a new key. */
	keyRetired = $state(false);
	progress = $state<SyncProgress | null>(null);
	usage = $state<SyncUsage | null>(null);
	readonly syncClientId = uid();
	syncedCursor = $state<number>(0);
	/** Every workspace on this device. Synced ones carry a sync key. */
	profiles = $state<StoredProfile[]>([]);
	/** The workspace this window reads and writes. */
	/** Empty until the keyring names a workspace for this window. */
	activeId = $state('');
	private profilesReady: Promise<void> | null = null;
	private bootstrapRequested = false;
	private pendingOutboxWrites: Promise<void> = Promise.resolve();
	private backgroundSessions = new Map<string, { accessToken: string; expiresAt: number }>();
	private session: { accountId: string; accessToken: string; expiresAt: number } | null = null;
	private pendingSessions = new Map<string, Promise<string>>();
	/** Attachment ids a note's retained versions list, as of the note's last change. */
	private versionAttachments = new Map<string, { updatedAt: number; ids: Set<string> }>();
	/** Notes open in the editor, by record key, with the envelope id each session last uploaded. */
	private editSessions = new Map<string, { uploadedId: string | null }>();
	private authenticationGeneration = 0;

	// Non-reactive callbacks avoid re-rendering the note grid for cloud feedback.
	onSyncStart: (() => void) | null = null;
	onSyncEnd: (() => void) | null = null;
	onAccountChange: (() => void) | null = null;
	/** Registered by the central data store so board edits share its debounced sync. */
	onLocalDataChange: (() => void) | null = null;

	constructor() {
		if (typeof localStorage === 'undefined') return;
		this.initFromLocalStorage();
		void this.ensureProfilesLoaded();
	}

	/**
	 * Fast boot from the keyring. The old default workspace is left out: it is
	 * not a workspace database until `ensureProfilesLoaded` has moved it, so
	 * nothing may open it before then.
	 */
	private initFromLocalStorage(): void {
		try {
			this.profiles = readProfiles().filter((entry) => entry.id !== LEGACY_WORKSPACE_ID);
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
	 * Per-window boot: move the old default workspace if this device still has
	 * one, restore the keyring, adopt installs that predate profiles, and
	 * activate the last-used profile. A device with no workspace gets a private
	 * one. Windows opened later start on the same profile but can switch
	 * independently.
	 */
	ensureProfilesLoaded(): Promise<void> {
		this.profilesReady ??= (async () => {
			try {
				await moveLegacyWorkspace().catch((err) =>
					console.error('[sync] could not move the old default workspace:', err)
				);
				let profiles = (await loadProfiles()).filter((entry) => entry.id !== LEGACY_WORKSPACE_ID);
				// Left in place on purpose: it is the only pointer a build without
				// profiles can use to find this device's account. It is cleared when
				// that account is unlinked, not when it is adopted.
				const rawLegacy =
					localStorage.getItem(LS_LEGACY_ACCOUNT_KEY) ??
					localStorage.getItem(LS_LEGACY_ACCOUNT_OLD);
				let legacySyncKey: string | null = null;
				try {
					const parsed: unknown = rawLegacy ? JSON.parse(rawLegacy) : null;
					if (isSyncAccount(parsed)) legacySyncKey = parsed.syncKey;
					if (isSyncAccount(parsed) && !profiles.some((p) => p.syncKey === parsed.syncKey)) {
						const adopted: StoredProfile = {
							id: randomOpaqueId(),
							name: nextProfileName(profiles),
							syncKey: parsed.syncKey,
							createdAt: Date.now()
						};
						await saveProfile(adopted);
						profiles = [...profiles, adopted];
					}
				} catch {
					/* unreadable legacy mirror is ignored */
				}
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
				this.migrateLegacySyncStatus(this.profiles, legacySyncKey);

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
			else await markSyncOutbox(id, [PROFILE_META_KEY]);
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
		this.clearLegacyAccountStorage();
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

	/** Move the single-workspace sync marker to the adopted profile exactly once. */
	private migrateLegacySyncStatus(profiles: StoredProfile[], legacySyncKey: string | null): void {
		if (typeof localStorage === 'undefined' || !legacySyncKey) return;
		const profile = profiles.find((entry) => entry.syncKey === legacySyncKey);
		if (!profile || this.readStatus(profile.id).lastSync > 0) return;

		const legacyStatus =
			localStorage.getItem(LS_SYNC_STATUS_PREFIX) ?? localStorage.getItem(LS_SYNC_STATUS_OLD);
		const lastSync = parseLastSync(legacyStatus);
		if (lastSync <= 0) return;

		try {
			localStorage.setItem(`${LS_SYNC_STATUS_PREFIX}:${profile.id}`, JSON.stringify({ lastSync }));
		} catch {
			/* status is only a display cache; a later sync will write it again */
		}
	}

	private restoreStatus(pid: string): void {
		this.lastSync = this.readStatus(pid).lastSync;
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

	private clearLegacyAccountStorage(): void {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.removeItem(LS_LEGACY_ACCOUNT_KEY);
			localStorage.removeItem(LS_LEGACY_ACCOUNT_OLD);
		} catch (err) {
			console.error('[sync] could not clear legacy account storage:', err);
		}
	}

	private saveStatus(): void {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(
				`${LS_SYNC_STATUS_PREFIX}:${this.activePid}`,
				JSON.stringify({ lastSync: this.lastSync })
			);
		} catch (err) {
			console.error('[sync] could not save status:', err);
		}
	}

	activateProfile(profile: StoredProfile): void {
		if (!profile.syncKey) {
			this.activateLocalWorkspace(profile.id);
			return;
		}
		this.activeId = profile.id;
		this.activateAccount(identityFromSyncKey(profile.syncKey));
		const generation = this.authenticationGeneration;
		this.lastError = null;
		this.keyRetired = false;
		this.progress = null;
		this.usage = null;
		this.syncedCursor = 0;
		const keys = syncControlKeys(identityFromSyncKey(profile.syncKey).accountId);
		void getSyncState<number>(profile.id, keys.cursor).then((c) => {
			if (
				typeof c === 'number' &&
				generation === this.authenticationGeneration &&
				this.activeProfile?.id === profile.id
			)
				this.syncedCursor = c;
		});
		setLastActiveProfileId(profile.id);
		this.restoreStatus(profile.id);
	}

	/** Activate a local-only namespace without removing any saved sync keys. */
	activateLocalWorkspace(id: string): void {
		this.authenticationGeneration += 1;
		this.pendingSessions.clear();
		this.session = null;
		this.account = null;
		this.activeId = id;
		this.lastError = null;
		this.keyRetired = false;
		this.progress = null;
		this.usage = null;
		this.syncedCursor = 0;
		setLastActiveProfileId(id);
		this.clearLegacyAccountStorage();
		this.restoreStatus(id);
		this.onAccountChange?.();
	}

	private activateAccount(account: SyncAccount): void {
		this.authenticationGeneration += 1;
		this.pendingSessions.clear();
		this.session = null;
		this.account = account;
		this.onAccountChange?.();
	}

	async reauthenticateForRecovery(turnstileToken?: string): Promise<void> {
		const account = this.account;
		if (!account) throw new Error('No synced workspace is active');
		this.backgroundSessions.delete(account.accountId);
		this.authenticationGeneration += 1;
		this.pendingSessions.clear();
		this.session = null;
		try {
			await this.accessToken(account);
			return;
		} catch {
			// A missing relay account can only be recreated during explicit recovery.
		}
		// Explicit recovery may recreate a missing relay account with the same signed identity.
		const response = await fetch('/api/sync/register', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				accountId: account.accountId,
				authPublicKey: account.authPublicKey,
				signature: signSyncRegistration(account.syncKey, account.accountId, account.authPublicKey),
				turnstileToken
			})
		});
		if (!response.ok && response.status !== 409) {
			const data = await response.json().catch(() => ({}));
			if (response.status === 410 && data.retired === true) throw this.retired(account);
			throw new Error(
				typeof data.error === 'string' ? data.error : 'Could not recover sync authentication'
			);
		}
		await this.accessToken(account);
	}

	/** Give a local workspace a fresh sync key. Its id, notes, and row stay the same. */
	async register(
		workspace: StoredProfile,
		name?: string,
		turnstileToken?: string
	): Promise<{ success: boolean; profile?: StoredProfile; error?: string }> {
		if (!isLocalWorkspace(workspace))
			return { success: false, error: 'That workspace is already synced' };
		return this.assignNewKey(
			{ ...workspace, name: name?.trim() || workspace.name },
			turnstileToken
		);
	}

	/**
	 * Move a workspace whose key was retired onto a new key and a new, empty
	 * account. Its id and notes stay; the next sync uploads them. The old key's
	 * sync state is dropped, since that account no longer exists.
	 */
	async replaceRetiredKey(
		workspace: StoredProfile,
		turnstileToken?: string
	): Promise<{ success: boolean; profile?: StoredProfile; error?: string }> {
		if (isLocalWorkspace(workspace))
			return { success: false, error: 'That workspace is not synced' };
		const result = await this.assignNewKey(workspace, turnstileToken);
		if (result.success) {
			await this.clearAccountControlPlane(
				identityFromSyncKey(workspace.syncKey).accountId,
				workspace.id
			);
		}
		return result;
	}

	private async assignNewKey(
		workspace: StoredProfile,
		turnstileToken?: string
	): Promise<{ success: boolean; profile?: StoredProfile; error?: string }> {
		const account = createSyncIdentity();
		try {
			const res = await fetch('/api/sync/register', {
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
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok)
				return {
					success: false,
					error: typeof data.error === 'string' ? data.error : 'Registration failed'
				};
			const profile: StoredProfile = { ...workspace, syncKey: account.syncKey };
			await this.replaceKeyringEntry(profile);
			this.clearLegacyAccountStorage();
			return { success: true, profile };
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : 'Network error' };
		}
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
			const res = await fetch('/api/sync/pair/start', {
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
			const res = await fetch('/api/sync/pair/poll', {
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
				const sent = await fetch('/api/sync/pair/approve', {
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
		if (
			this.session?.accountId === account.accountId &&
			this.session.expiresAt - Date.now() > 5_000
		)
			return this.session.accessToken;
		const backgroundSession = this.backgroundSessions.get(account.accountId);
		if (backgroundSession && backgroundSession.expiresAt - Date.now() > 5_000)
			return backgroundSession.accessToken;
		const pendingSession = this.pendingSessions.get(account.accountId);
		if (pendingSession) return pendingSession;
		const generation = this.authenticationGeneration;
		const sessionRequest = (async () => {
			const challengeResponse = await fetch('/api/sync/auth/challenge', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ accountId: account.accountId })
			});
			const challenge = (await challengeResponse.json().catch(() => ({}))) as {
				challengeId?: unknown;
				challenge?: unknown;
				migrationRequired?: unknown;
				retired?: unknown;
			};
			if (challengeResponse.status === 410 && challenge.retired === true) {
				throw this.retired(account);
			}
			if (challengeResponse.status === 409 && challenge.migrationRequired === true) {
				const migrationResponse = await fetch('/api/sync/auth/migrate', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						accountId: account.accountId,
						authSecret: legacyAuthSecret(account.syncKey),
						authPublicKey: account.authPublicKey,
						signature: signSyncMigration(account.syncKey, account.accountId, account.authPublicKey)
					})
				});
				return this.acceptIssuedSession(account, migrationResponse, generation);
			}
			if (
				!challengeResponse.ok ||
				typeof challenge.challengeId !== 'string' ||
				typeof challenge.challenge !== 'string'
			) {
				throw new Error('Could not start sync authentication');
			}
			const sessionResponse = await fetch('/api/sync/auth/session', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					accountId: account.accountId,
					challengeId: challenge.challengeId,
					signature: signSyncChallenge(account.syncKey, account.accountId, challenge.challenge)
				})
			});
			return this.acceptIssuedSession(account, sessionResponse, generation);
		})();
		this.pendingSessions.set(account.accountId, sessionRequest);
		try {
			return await sessionRequest;
		} finally {
			if (this.pendingSessions.get(account.accountId) === sessionRequest)
				this.pendingSessions.delete(account.accountId);
		}
	}

	/** Record that the relay refused this key for good, when it is the active one. */
	private retired(account: SyncAccount): Error {
		if (this.account?.accountId === account.accountId) this.keyRetired = true;
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
		const active = this.account?.accountId === account.accountId;
		// A switch, logout or recovery cancels what would become the open workspace's
		// session. A token for another workspace still saved here stays good.
		if (
			generation !== this.authenticationGeneration &&
			(active || !this.profiles.some((profile) => profile.syncKey === account.syncKey))
		)
			throw new Error('Sync authentication was cancelled');
		if (active) {
			this.session = {
				accountId: account.accountId,
				accessToken: issued.accessToken,
				expiresAt: issued.expiresAt
			};
		}
		this.backgroundSessions.set(account.accountId, {
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
		if (this.backgroundSessions.get(accountId)?.accessToken === accessToken)
			this.backgroundSessions.delete(accountId);
		if (this.session?.accountId === accountId && this.session.accessToken === accessToken)
			this.session = null;
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
		note: Note
	): Promise<Set<string> | null> {
		const key = `${account.accountId}\u0000${note.id}`;
		const cached = this.versionAttachments.get(key);
		if (cached?.updatedAt === note.updatedAt) return cached.ids;
		try {
			// Loaded on demand: the history client itself fetches through this store.
			const { loadNoteHistory } = await import('$lib/historyClient');
			const versions = await loadNoteHistory(account, note.id);
			const ids = new Set(
				versions.flatMap((version) => (version.note.images ?? []).map((image) => image.id))
			);
			this.versionAttachments.set(key, { updatedAt: note.updatedAt, ids });
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
			const accessToken = await this.accessToken(account);
			const headers = new Headers(init.headers);
			headers.set('authorization', `Bearer ${accessToken}`);
			headers.set('x-sync-client-id', this.syncClientId);
			const response = await fetch(input, { ...init, headers });
			if (response.status !== 401 || attempt === 1) return response;
			this.invalidateSession(account.accountId, accessToken);
		}
		throw new Error('Sync authentication failed');
	}

	private async sendSyncRequest(
		path: string,
		payload: string,
		uploadBytes: number,
		indicate: boolean,
		account: SyncAccount | null = this.account
	): Promise<SyncResult> {
		if (!account) return { success: false, error: 'Not linked' };
		for (let attempt = 0; attempt < 2; attempt += 1) {
			let accessToken: string;
			try {
				accessToken = await this.accessToken(account);
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : 'Authentication failed'
				};
			}
			const result = await this.sendSyncRequestWithToken(
				path,
				payload,
				uploadBytes,
				indicate,
				accessToken
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
		indicate: boolean,
		accessToken: string
	): Promise<SyncResult> {
		return new Promise((resolve) => {
			const xhr = new XMLHttpRequest();
			xhr.open('POST', path);
			// Pairing expires in 60 seconds; photo/data sync must be allowed to finish.
			xhr.timeout = 300_000;
			xhr.setRequestHeader('Content-Type', 'application/json');
			xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
			xhr.setRequestHeader('x-sync-client-id', this.syncClientId);

			const showTransfer = indicate && uploadBytes >= 32 * 1024;
			if (showTransfer) {
				this.progress = { phase: 'upload', loadedBytes: 0, totalBytes: uploadBytes };
				xhr.upload.onprogress = (event) => {
					this.progress = {
						phase: 'upload',
						loadedBytes: event.loaded,
						totalBytes: event.lengthComputable ? event.total : uploadBytes
					};
				};
			}
			if (indicate) {
				xhr.onprogress = (event) => {
					if (!event.lengthComputable || event.total < 32 * 1024) return;
					this.progress = {
						phase: 'download',
						loadedBytes: event.loaded,
						totalBytes: event.total
					};
				};
			}

			let sentAt = 0;
			xhr.onload = () => {
				const receivedAt = Date.now();
				let data: Record<string, unknown> = {};
				try {
					data = JSON.parse(xhr.responseText || '{}') as Record<string, unknown>;
				} catch {
					/* handled below */
				}
				observeRelayTime(data.serverTime, sentAt, receivedAt);
				if (xhr.status < 200 || xhr.status >= 300) {
					const retryAfter = Number(xhr.getResponseHeader('retry-after'));
					resolve({
						success: false,
						status: xhr.status,
						error:
							typeof data.error === 'string' ? data.error : `Sync request failed (${xhr.status})`,
						...((xhr.status === 429 || xhr.status === 503) &&
						Number.isFinite(retryAfter) &&
						retryAfter >= 0
							? { retryAfterSeconds: retryAfter }
							: {})
					});
					return;
				}
				resolve({ success: true, data });
			};
			xhr.onerror = () => resolve({ success: false, error: 'Sync network error' });
			xhr.ontimeout = () => resolve({ success: false, error: 'Sync timed out' });
			xhr.onabort = () => resolve({ success: false, error: 'Sync was cancelled' });
			sentAt = Date.now();
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

	/** End-to-end encrypted per-record delta. Uploads only dirty outbox keys. */
	async sync(
		local: SyncSnapshot,
		indicate = false,
		pullOnly = false,
		applyPulled?: ApplyPulled
	): Promise<SyncResult> {
		if (!this.account) return { success: false, error: 'Not linked' };
		const account = this.account;
		const pid = this.activePid;
		const syncCancelled = (): boolean => this.account !== account;
		if (indicate) this.onSyncStart?.();
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
			let baseline: Record<string, string> = {};
			try {
				const durable = await getSyncState<unknown>(pid, keys.baseline);
				if (durable && typeof durable === 'object' && !Array.isArray(durable))
					baseline = Object.fromEntries(
						Object.entries(durable).filter(
							([key, value]) => typeof key === 'string' && typeof value === 'string'
						)
					);
			} catch {
				/* first sync */
			}
			const firstFullUpload = Object.keys(baseline).length === 0;
			let recordIds =
				(await getSyncState<Record<string, string>>(pid, keys.recordIds).catch(() => undefined)) ??
				{};
			if (!recordIds || typeof recordIds !== 'object' || Array.isArray(recordIds)) recordIds = {};
			const outboxSnapshotAt = await getOutboxGeneration(pid);
			let outboxKeys = new Set(await getSyncOutboxKeys(pid).catch(() => []));
			let cursor = Number(
				(await getSyncState<number>(pid, keys.cursor).catch(() => undefined)) || 0
			);
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
					if (image.dataUrl?.length) attachments.set(image.id, image);
				}
			}

			let hasMore = true;
			let downloadsDrained = false;
			const acknowledgedOutbox = new Set<string>();
			const internallyMarkedOutbox = new Map<string, number>();
			let poisonCount = 0;
			let stalledWrites = 0;
			/** Records the relay still holds in the pre-slot-binding format. Rewriting
			 * them is how that format leaves an account, and the only thing that can
			 * ever make the read path for it safe to delete. */
			const unboundRecordKeys = new Set<string>();
			while (hasMore) {
				if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
				const startedWithDownloadsDrained = downloadsDrained;
				const uploadKeys =
					pullOnly || !downloadsDrained
						? new Set<string>()
						: firstFullUpload
							? undefined
							: outboxKeys;
				const currentRecords = await buildSyncRecords(merged, uploadKeys);
				const metaUploadDue =
					!pullOnly &&
					downloadsDrained &&
					outboxKeys.has(PROFILE_META_KEY) &&
					!quotaBlockedKeys.has(PROFILE_META_KEY) &&
					(uploadKeys === undefined || uploadKeys.has(PROFILE_META_KEY));
				if (metaUploadDue) {
					const metaPayload = {
						kind: 'profile-meta' as const,
						value: { name: this.activeProfile?.name ?? '' }
					};
					currentRecords.push({
						key: PROFILE_META_KEY,
						fingerprint: await sha256(metaPayload),
						payload: metaPayload
					});
				}
				const changed =
					pullOnly || !downloadsDrained ? [] : changedRecords(currentRecords, baseline);
				const nonAttachments = changed.filter(
					(record) => record.payload.kind !== 'attachment' && !quotaBlockedKeys.has(record.key)
				);
				const changedAttachments = changed.filter(
					(record) => record.payload.kind === 'attachment' && !quotaBlockedKeys.has(record.key)
				);
				// Notes/labels/boards go before photos so one over-quota image cannot strand text.
				const recordBudget = quotaSingleUpload ? 1 : MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST;
				const attachBudget = quotaSingleUpload ? 1 : ATTACHMENT_UPLOAD_BUDGET;
				const outgoing = nonAttachments.length
					? nonAttachments.slice(0, recordBudget)
					: changedAttachments.slice(0, attachBudget);
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
						const uploadedId = this.editSessions.get(record.key)?.uploadedId;
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
				const deletableKeys = (
					await withoutAttachmentsHistoryNeeds(
						planDeletableKeys({
							recordIds,
							snapshot: merged,
							pullOnly,
							catchUpComplete: downloadsDrained
						}),
						merged.notes,
						merged.tombstones,
						(note) => this.versionAttachmentIds(account, note)
					)
				)
					.filter((key) => key !== PROFILE_META_KEY)
					.slice(0, MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST - outbound.length);
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
					'/api/sync/delta',
					payload,
					new Blob([payload]).size,
					indicate,
					account
				);
				if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
				if (!response.success && response.status === 507 && outgoing.length > 0) {
					if (outgoing.length > 1) quotaSingleUpload = true;
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
					await new Promise((resolve) =>
						setTimeout(resolve, Math.min(response.retryAfterSeconds!, 30) * 1000)
					);
					continue;
				}
				if (!response.success || !response.data) return this.fail(response);
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
						this.usage = candidate as SyncUsage;
					}
				}
				const writesAccepted = response.data.writesAccepted === true;
				if (writesAccepted) {
					stalledWrites = 0;
					for (const key of deletableKeys) delete recordIds[key];
					for (const [key, id] of sentRecordIds) {
						recordIds[key] = id;
						const session = this.editSessions.get(key);
						if (session) session.uploadedId = id;
					}
					for (const key of deletableKeys) acknowledgedOutbox.add(key);
				}
				if (response.data.reset === true) {
					// The relay was deliberately reset while this device retained a baseline.
					// Ask the notes store to reload full attachments before its retry.
					resetRetries += 1;
					if (resetRetries > MAX_RESET_RETRIES)
						throw new Error('Relay repeatedly requested a state reset');
					this.bootstrapRequested = true;
					baseline = {};
					recordIds = {};
					cursor = 0;
					continue;
				}

				const pendingNotes: Note[] = [];
				const remoteFingerprints: Record<string, string> = {};
				let decodedAny = false;
				let adoptedConflictId = false;
				const applyPayload = (record: SyncRecordPayload) => {
					switch (record.kind) {
						case 'attachment':
							attachments.set(record.value.id, attachmentToImage(record.value));
							break;
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
							if (typeof (record as { value?: { name?: unknown } }).value?.name === 'string')
								this.applySyncedProfileName(
									(record as { value: { name: string } }).value.name,
									pid
								);
							break;
					}
				};
				const downloaded = Array.isArray(response.data.envelopes) ? response.data.envelopes : [];
				const envelopes = [
					...downloaded,
					...(Array.isArray(response.data.conflicts) ? response.data.conflicts : [])
				];
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
					let decodedUnbound = false;
					try {
						const remote = decryptSyncEnvelope(
							account.syncKey,
							(envelope as { ciphertext: string }).ciphertext,
							slot
						);
						decodedUnbound = remote.legacy;
						decodedRecords = isSyncRecordPayload(remote.payload) ? [remote.payload] : null;
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
						if (decodedUnbound) unboundRecordKeys.add(key);
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

				if (typeof response.data.cursor === 'number') {
					cursor = response.data.cursor;
				}
				downloadsDrained = response.data.hasMore !== true;

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
					merged = await applyPulled(merged, pid);
					for (const note of merged.notes) {
						for (const image of note.images ?? []) {
							if (image.dataUrl?.length) attachments.set(image.id, image);
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
				if (reconciled.dirtyKeys.length) {
					const generation = await markSyncOutbox(pid, reconciled.dirtyKeys);
					for (const key of reconciled.dirtyKeys) {
						outboxKeys.add(key);
						internallyMarkedOutbox.set(key, generation);
					}
				}

				if (downloadsDrained) {
					for (const key of outboxKeys) {
						if (!currentKeys.has(key)) {
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
					await commitSyncControl(
						pid,
						[
							[keys.cursor, cursor],
							[keys.baseline, baseline],
							[keys.recordIds, recordIds]
						],
						[
							{ keys: acknowledgedOutbox, through: outboxSnapshotAt },
							...[...internalAcknowledgements].map(([markedAt, keysAtGeneration]) => ({
								keys: keysAtGeneration,
								through: markedAt
							}))
						]
					);
					this.syncedCursor = cursor;
					for (const keysAtGeneration of internalAcknowledgements.values()) {
						for (const key of keysAtGeneration) internallyMarkedOutbox.delete(key);
					}
				}

				const pendingOutboxUpload = [...outboxKeys].some(
					(key) => !acknowledgedOutbox.has(key) && !quotaBlockedKeys.has(key)
				);
				const remainingUploads =
					!pullOnly &&
					((!startedWithDownloadsDrained && (firstFullUpload || pendingOutboxUpload)) ||
						(!writesAccepted && (outgoing.length > 0 || deleteSlots.length > 0)) ||
						changed.filter((record) => !quotaBlockedKeys.has(record.key)).length > outgoing.length);
				const pendingDeletes =
					downloadsDrained &&
					planDeletableKeys({
						recordIds,
						snapshot: merged,
						pullOnly,
						catchUpComplete: true
					}).length > 0;
				hasMore = syncRoundHasMore({
					remoteHasMore: response.data.hasMore === true,
					remainingUploads,
					pendingDeletes
				});
			}

			if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
			// Queued rather than uploaded here: the next pass carries them like any
			// other change, so a large account migrates over several syncs instead of
			// one oversized one.
			if (unboundRecordKeys.size > 0) await this.queueOutbox(unboundRecordKeys);
			if (poisonCount > 0) {
				this.lastError = `Skipped ${poisonCount} unreadable sync record${poisonCount === 1 ? '' : 's'}`;
			} else if (quotaBlockedKeys.size > 0) {
				this.lastError = 'Sync incomplete: account storage quota prevented some uploads';
				return { success: false, error: this.lastError };
			} else {
				this.lastError = null;
			}
			this.lastSync = Date.now();
			this.saveStatus();
			return { success: true, snapshot: merged };
		} catch (err) {
			if (syncCancelled()) return { success: false, error: 'Sync was cancelled' };
			return this.fail({
				success: false,
				error:
					err instanceof Error ? `Encrypted sync failed: ${err.message}` : 'Encrypted sync failed'
			});
		} finally {
			if (indicate) this.progress = null;
			if (indicate) this.onSyncEnd?.();
		}
	}

	private fail(result: SyncResult): SyncResult {
		this.lastError = result.error || 'Sync failed';
		return { success: false, error: this.lastError };
	}

	consumeCurrentStateBootstrapRequest(): boolean {
		const requested = this.bootstrapRequested;
		this.bootstrapRequested = false;
		return requested;
	}

	async needsCurrentStateBootstrap(): Promise<boolean> {
		if (!this.account) return false;
		const baseline = await getSyncState<Record<string, string>>(
			this.activePid,
			syncControlKeys(this.account.accountId).baseline
		).catch(() => undefined);
		return !baseline || Object.keys(baseline).length === 0;
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
			deleteSyncState(pid, keys.recordIds)
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
		this.clearLegacyAccountStorage();
		await this.clearAccountControlPlane(accountId, profile.id);
		const pending = await getSyncOutboxKeys(profile.id).catch(() => []);
		await clearSyncOutbox(profile.id, pending);
		return unlinked;
	}

	/** Delete a workspace's relay account, then keep its notes here as a private workspace. */
	async deleteCloudAccount(profile: StoredProfile): Promise<{ success: boolean; error?: string }> {
		if (!profile.syncKey) return { success: false, error: 'That workspace is not synced' };
		try {
			const response = await this.authorizedFetch(
				'/api/sync/account',
				{ method: 'DELETE' },
				identityFromSyncKey(profile.syncKey)
			);
			if (!response.ok) {
				const data = (await response.json().catch(() => ({}))) as { error?: unknown };
				return {
					success: false,
					error: typeof data.error === 'string' ? data.error : 'Could not delete synced data'
				};
			}
			await this.unlinkProfile(profile);
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
