import { rewriteWorkspace } from '#lib/db/idb.js';
import { LS_PROFILES } from '#lib/profiles.js';

/** The workspace every store starts on in tests. */
export const TEST_WORKSPACE = 'test-workspace';

/** Name it in the keyring, as a device that has booted once would. */
export function seedTestKeyring(): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(
		LS_PROFILES,
		JSON.stringify([{ id: TEST_WORKSPACE, name: 'Test workspace', syncKey: '', createdAt: 0 }])
	);
	localStorage.setItem('scrapscache-last-active-profile', TEST_WORKSPACE);
}

/** Drop every note, attachment and label a workspace holds on this device. */
export function emptyWorkspace(pid: string): Promise<void> {
	return rewriteWorkspace(pid, [], [], () => ({ clear: true, notes: [], labels: [] }));
}
