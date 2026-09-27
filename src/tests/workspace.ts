import { LS_PROFILES } from '$lib/db/idb';

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
