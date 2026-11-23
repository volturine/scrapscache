import type { SyncAccount } from '#lib/relayClient.js';
import { syncStore } from '#lib/stores/sync.svelte.js';
import { syncScheduler } from '#lib/stores/syncScheduler.js';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { TEST_WORKSPACE } from './workspace';

/**
 * Show the open workspace as syncing or not, the way the scheduler does while its
 * lane is in flight, without a sync running.
 */
export function showOpenWorkspaceSyncing(on: boolean): void {
	const { flights } = syncScheduler as unknown as { flights: Map<string, Promise<boolean>> };
	if (on) flights.set(syncStore.activePid, new Promise(() => undefined));
	else flights.delete(syncStore.activePid);
}

/**
 * Make the test workspace a synced one, open in this window: named in the keyring
 * under a key of its own, or under `syncKey`, as on a device that syncs. Returns
 * its account.
 */
export function linkTestWorkspace(syncKey: string = createSyncIdentity().syncKey): SyncAccount {
	const profile = { id: TEST_WORKSPACE, name: 'Test workspace', syncKey, createdAt: 0 };
	forgetSyncStates();
	syncStore.profiles = [profile];
	syncStore.activateProfile(profile);
	if (!syncStore.account) throw new Error('The test workspace did not link');
	return syncStore.account;
}

/** Back to the private test workspace every test starts on. */
export function unlinkTestWorkspace(): void {
	syncStore.profiles = [];
	syncStore.activateLocalWorkspace(TEST_WORKSPACE);
	forgetSyncStates();
}

/** What earlier cases learned of each workspace's sync is not the next one's. */
export function forgetSyncStates(): void {
	(syncStore as unknown as { states: object }).states = {};
}
