import { RelayClient } from '#lib/relayClient.js';
import { RelaySync, type ApplyPulled, type SyncResult } from '#lib/relaySync.js';
import type { SyncSnapshot } from '#lib/syncRecords.js';
import type { SyncStore } from '#lib/stores/sync.svelte.js';

const made = new WeakMap<SyncStore, { relay: RelayClient; engine: RelaySync }>();

/**
 * The relay client and sync engine of a store a test made, wired to it as the
 * app's own are to its store: sign-ins and syncs of one test stay its own.
 */
export function syncParts(store: SyncStore): { relay: RelayClient; engine: RelaySync } {
	let parts = made.get(store);
	if (!parts) {
		const relay = new RelayClient();
		relay.onRetired = (account) => store.keyRetiredOn(account.syncKey);
		parts = { relay, engine: new RelaySync(relay, store) };
		made.set(store, parts);
	}
	return parts;
}

/**
 * Run the sync engine for the workspace a store has open, with `local` as the
 * copy it sends and merges into. A store given an account without a workspace
 * gets the workspace named in its keyring first, as a device that syncs has.
 */
export async function syncOpen(
	store: SyncStore,
	local: SyncSnapshot,
	applyPulled: ApplyPulled = async (snapshot) => snapshot,
	signal: AbortSignal = new AbortController().signal
): Promise<SyncResult> {
	const account = store.account;
	if (!account) return { success: false, error: 'Not linked' };
	// The keyring loads once a store exists, and would replace the entry added here.
	await store.ensureProfilesLoaded();
	const pid = store.activePid;
	let profile = store.profiles.find(
		(entry) => entry.id === pid && entry.syncKey === account.syncKey
	);
	if (!profile) {
		profile = { id: pid, name: '', syncKey: account.syncKey, createdAt: 0 };
		store.profiles = [...store.profiles.filter((entry) => entry.id !== pid), profile];
	}
	return syncParts(store).engine.sync(profile, local, applyPulled, signal);
}
