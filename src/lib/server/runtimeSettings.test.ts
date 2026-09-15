import { afterEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('$env/dynamic/private', () => ({ env: envMock }));

import { cleanupTestDbs, testDb } from './testDb';
import {
	getRuntimeSettingsState,
	parseRuntimeSettingsPatch,
	updateRuntimeSettings
} from './runtimeSettings';

afterEach(() => {
	for (const key of Object.keys(envMock)) delete envMock[key];
	cleanupTestDbs();
});

describe('runtime settings', () => {
	it('uses deployment defaults until an operator saves overrides', async () => {
		envMock.SCRAPSCACHE_SYNC_MAX_ACCOUNT_BYTES = '5000';
		envMock.SCRAPSCACHE_SYNC_MAX_CONCURRENT_REQUESTS = '4';
		envMock.SCRAPSCACHE_RETENTION_INACTIVE_DAYS = '365';
		envMock.SCRAPSCACHE_ALLOW_INDEXING = 'true';
		envMock.SCRAPSCACHE_ORIGIN = 'https://notes.example';
		const db = testDb();

		const initial = await getRuntimeSettingsState(db);
		expect(initial.values).toMatchObject({
			maxAccountBytes: 5_000,
			maxConcurrentSyncRequests: 4,
			retentionInactiveDays: 365,
			allowIndexing: true,
			vapidSubject: 'https://notes.example'
		});
		expect(initial.overrides).toEqual({});

		const saved = await updateRuntimeSettings(
			{
				maxAccountBytes: 9_000,
				syncPerMinute: 12,
				maxConcurrentSyncRequests: 2,
				retentionInactiveDays: 30,
				allowIndexing: false,
				vapidSubject: 'mailto:ops@example.com'
			},
			db
		);
		expect(saved.values).toEqual({
			maxAccountBytes: 9_000,
			syncPerMinute: 12,
			maxConcurrentSyncRequests: 2,
			retentionInactiveDays: 30,
			allowIndexing: false,
			vapidSubject: 'mailto:ops@example.com'
		});
	});

	it('removes overrides when a field is reset to null', async () => {
		envMock.SCRAPSCACHE_RETENTION_INACTIVE_DAYS = '365';
		const db = testDb();
		await updateRuntimeSettings({ retentionInactiveDays: 30 }, db);

		const reset = await updateRuntimeSettings({ retentionInactiveDays: null }, db);

		expect(reset.values.retentionInactiveDays).toBe(365);
		expect(reset.overrides).not.toHaveProperty('retentionInactiveDays');
	});

	it('rejects invalid and unknown values', () => {
		for (const value of [
			{ maxAccountBytes: 0 },
			{ syncPerMinute: 1.5 },
			{ maxConcurrentSyncRequests: -1 },
			{ retentionInactiveDays: -1 },
			{ allowIndexing: 'yes' },
			{ vapidSubject: 'javascript:alert(1)' },
			{ madeUp: true }
		]) {
			expect(() => parseRuntimeSettingsPatch(value)).toThrow(RangeError);
		}
	});

	it('ignores corrupt stored values instead of weakening a default', async () => {
		const db = testDb();
		await db.ready;
		await db.ops.execute({
			sql: 'INSERT INTO meta(key, value) VALUES (?, ?)',
			args: ['runtime-setting:maxConcurrentSyncRequests', '0']
		});

		const settings = await getRuntimeSettingsState(db);

		expect(settings.values.maxConcurrentSyncRequests).toBe(8);
		expect(settings.overrides).toEqual({});
	});
});
