import type { SyncSnapshot } from '#lib/syncRecords.js';
import type { ApplyPulled, SyncStore } from '#lib/stores/sync.svelte.js';

/**
 * Run the sync engine for the workspace a store has open, with `local` as the
 * copy it sends and merges into. A store given an account without a workspace
 * gets the workspace named in its keyring first, as a device that syncs has.
 */
export async function syncOpen(
	store: SyncStore,
	local: SyncSnapshot,
	pullOnly = false,
	applyPulled: ApplyPulled = async (snapshot) => snapshot,
	signal: AbortSignal = new AbortController().signal
): ReturnType<SyncStore['pullOpen']> {
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
	return pullOnly
		? store.pullOpen(local, applyPulled, signal)
		: store.syncWorkspace(profile, local, applyPulled, signal);
}
