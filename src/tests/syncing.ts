import { syncStore } from '#lib/stores/sync.svelte.js';
import { syncScheduler } from '#lib/stores/syncScheduler.js';

/**
 * Show the open workspace as syncing or not, the way the scheduler does while its
 * lane is in flight, without a sync running.
 */
export function showOpenWorkspaceSyncing(on: boolean): void {
	const { flights } = syncScheduler as unknown as { flights: Map<string, Promise<boolean>> };
	if (on) flights.set(syncStore.activePid, new Promise(() => undefined));
	else flights.delete(syncStore.activePid);
}
