// The workspaces on this device, the one this window shows, and what is known of
// each one's sync. Talking to the relay is `relayClient.ts`; a sync itself is
// `relaySync.ts`, which records what it learns here.

import {
	clearSyncOutbox,
	DeleteBlockedError,
	deleteSyncState,
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
import { relay, type SyncAccount, type SyncProgress } from '#lib/relayClient.js';
import {
	NOTHING_KNOWN,
	RelaySync,
	type SyncHost,
	type SyncUsage,
	type WorkspaceSyncState
} from '#lib/relaySync.js';
import { syncControlKeys } from '#lib/syncEngine.js';
import { SyncEventsClient } from '#lib/syncEventsClient.js';
import { identityFromSyncKey, randomOpaqueId } from '#lib/syncPairing.js';

const LS_SYNC_STATUS_PREFIX = 'scrapscache-sync-status';

interface SyncStatus {
	lastSync: number;
}

function parseLastSync(raw: string | null): number {
	if (!raw) return 0;
	try {
		return Number((JSON.parse(raw) as SyncStatus).lastSync) || 0;
	} catch {
		return 0;
	}
}

/** Shown when a sync settled but left out photos this device could not read. */
const UNREADABLE_ATTACHMENTS =
	'Synced, but some photos could not be prepared for upload. They will retry on the next sync.';

export class SyncStore implements SyncHost {
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
	state(pid: string, syncKey?: string): WorkspaceSyncState {
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
	/** Every workspace on this device. Synced ones carry a sync key. */
	profiles = $state<StoredProfile[]>([]);
	/** The workspace this window reads and writes. Empty until the keyring names one for it. */
	activeId = $state('');
	private profilesReady: Promise<void> | null = null;
	// Non-reactive callbacks avoid re-rendering the note grid for cloud feedback.
	onAccountChange: (() => void) | null = null;

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

	/** Give a workspace another name in the keyring. Whoever asks sends the name on. */
	async renameProfile(id: string, name: string): Promise<StoredProfile | null> {
		const trimmed = name.trim().slice(0, 60);
		if (!trimmed) return null;
		const profile = this.profiles.find((entry) => entry.id === id);
		if (!profile || profile.name === trimmed) return profile ?? null;
		const updated = { ...profile, name: trimmed };
		await saveProfile(updated);
		this.profiles = this.profiles.map((entry) => (entry.id === id ? updated : entry));
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

	/** A workspace settled with the relay: when is kept across starts. */
	settled(pid: string, lastSync: number): void {
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

	/** What was learned of every workspace's sync no longer holds. */
	forgetSync(): void {
		this.states = {};
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

	/** The relay refused this key for good: so it is for every workspace on it. */
	keyRetiredOn(syncKey: string): void {
		for (const profile of this.profiles) {
			if (profile.syncKey === syncKey) this.state(profile.id, syncKey).keyRetired = true;
		}
	}

	/** The workspace's name, which travels as an encrypted record of its own. */
	name(pid: string): string {
		return this.profiles.find((entry) => entry.id === pid)?.name ?? '';
	}

	/** Adopt a name received from that record, for the workspace that synced it. */
	named(pid: string, name: string): void {
		const trimmed = name.trim().slice(0, 60);
		const profile = this.profiles.find((entry) => entry.id === pid);
		if (!profile || !trimmed || profile.name === trimmed) return;
		const updated = { ...profile, name: trimmed };
		this.profiles = this.profiles.map((entry) => (entry.id === profile.id ? updated : entry));
		void saveProfile(updated).catch((err) =>
			console.error('[sync] could not store the synced profile name:', err)
		);
	}

	/** True while this device holds `pid` under this key. */
	holds(pid: string, syncKey: string): boolean {
		return (
			!isProfileReleased(pid) &&
			this.profiles.some((entry) => entry.id === pid && entry.syncKey === syncKey)
		);
	}

	/** Photos this device could not read were left out of a sync that otherwise settled. */
	attachmentsUnreadable(pid: string, some: boolean): void {
		const state = this.state(pid);
		if (some) state.lastError = UNREADABLE_ATTACHMENTS;
		else if (state.lastError === UNREADABLE_ATTACHMENTS) state.lastError = null;
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
}

export const syncStore = new SyncStore();
relay.onRetired = (account) => syncStore.keyRetiredOn(account.syncKey);
/** Syncs of this device's workspaces with the relay. */
export const relaySync = new RelaySync(relay, syncStore);
/** Live changes of the workspace this window shows. */
export const syncEventsClient = new SyncEventsClient(relay, () => syncStore.account);
syncStore.onAccountChange = () => syncEventsClient.accountChanged();

/** The app's server setting moved: sign-ins, sync state and the live connection were the old server's. */
export function serverChanged(): void {
	relay.serverChanged();
	syncStore.forgetSync();
	syncEventsClient.accountChanged();
}
