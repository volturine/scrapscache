import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupTestDbs, testDb } from './testDb';
import { runRetentionSweep, type RetentionStore } from './retentionSweep';
import { updateRuntimeSettings } from './runtimeSettings';

afterEach(() => cleanupTestDbs());

describe('runtime retention policy', () => {
	it('uses the current database setting and can be disabled without a restart', async () => {
		const db = testDb();
		const store: RetentionStore = {
			deleteInactiveAccounts: vi.fn(async () => 2),
			purgeExpiredDeletedEnvelopes: vi.fn(async () => 0)
		};
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		const now = 10 * 86_400_000;
		await updateRuntimeSettings({ retentionInactiveDays: 2 }, db);

		const enabled = await runRetentionSweep({ db, store, now: () => now, force: true });

		expect(store.deleteInactiveAccounts).toHaveBeenCalledWith(8 * 86_400_000);
		expect(enabled).toMatchObject({ enabled: true, inactiveDays: 2, lastDeletedAccounts: 2 });

		vi.mocked(store.deleteInactiveAccounts).mockClear();
		await updateRuntimeSettings({ retentionInactiveDays: 0 }, db);
		const disabled = await runRetentionSweep({ db, store, now: () => now + 1, force: true });

		expect(store.deleteInactiveAccounts).not.toHaveBeenCalled();
		expect(disabled).toMatchObject({ enabled: false, inactiveDays: 0 });
		info.mockRestore();
	});
});
