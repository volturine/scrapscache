import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, testD1, testR2 } from './testBindings';

const bindings = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('./env', () => ({ cloudflareBindings: () => bindings.value }));

import { SyncStore } from './syncStore';

let store: SyncStore;

beforeEach(async () => {
	const d1 = testD1();
	await applyMigrations(d1.client);
	bindings.value = { SCRAPSCACHE_DB: d1.db, SCRAPSCACHE_ENVELOPES: testR2().bucket };
	store = new SyncStore();
});

describe('Workers reminder wake schedule', () => {
	it('reports the next wake a registered device still waits for', async () => {
		await store.createAccount('account', 'credential');
		const wake = (letter: string, fireAt: number) => ({ id: letter.repeat(43), fireAt });
		await store.replaceReminderWakes('account', [wake('a', 1_000), wake('b', 5_000)]);
		expect(await store.nextWakeAt(0)).toBeNull();
		await store.savePushDevice({
			deviceId: 'device-aaaaaaaaaaaa',
			endpoint: 'https://push.example/sub-a',
			p256dh: 'p'.repeat(20),
			auth: 'a'.repeat(16),
			accountId: 'account'
		});
		expect(await store.nextWakeAt(0)).toBe(1_000);
		expect(await store.nextWakeAt(1_000)).toBe(1_000);
		expect(await store.nextWakeAt(5_000)).toBe(5_000);
		expect(await store.nextWakeAt(0, 'account')).toBe(1_000);
		expect(await store.nextWakeAt(0, 'someone-else')).toBeNull();
		expect((await store.claimDueWakes(1_000, 100, 'someone-else')).length).toBe(0);
		expect((await store.claimDueWakes(1_000, 100, 'account')).map((w) => w.wakeId)).toEqual([
			'a'.repeat(43)
		]);
	});

	it('returns wakes and revision for an account', async () => {
		await store.createAccount('account-wakes', 'credential');
		const wake = (letter: string, fireAt: number) => ({ id: letter.repeat(43), fireAt });
		await store.replaceReminderWakes('account-wakes', [wake('a', 1_000), wake('b', 5_000)], 42);
		const result = await store.getReminderWakes('account-wakes');
		expect(result.revision).toBe(42);
		expect(result.wakes).toEqual([wake('a', 1_000), wake('b', 5_000)]);
	});
});
