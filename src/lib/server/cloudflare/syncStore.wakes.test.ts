import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, testD1, testR2 } from './testBindings';

const bindings = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('./env', () => ({ cloudflareBindings: () => bindings.value }));

import { SyncStore, WAKE_CLAIM_ACCOUNT_LIMIT } from './syncStore';

let store: SyncStore;
let client: ReturnType<typeof testD1>['client'];

beforeEach(async () => {
	const d1 = testD1();
	client = d1.client;
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

	it('moves an endpoint registration when another account claims it without evicting matching device ids', async () => {
		await store.createAccount('old-owner', 'credential-old');
		await store.createAccount('new-owner', 'credential-new');
		const keys = { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) };
		await store.savePushDevice({
			accountId: 'old-owner',
			deviceId: 'device-old00000000',
			endpoint: 'https://push.example/endpoint-a',
			...keys
		});
		await store.savePushDevice({
			accountId: 'new-owner',
			deviceId: 'device-new00000000',
			endpoint: 'https://push.example/endpoint-b',
			...keys
		});
		// A re-registered endpoint under a different account steals it from the old row.
		await store.savePushDevice({
			accountId: 'new-owner',
			deviceId: 'device-replaced000',
			endpoint: 'https://push.example/endpoint-a',
			...keys
		});
		expect(await store.countPushDevices('old-owner')).toBe(0);
		expect(await store.countPushDevices('new-owner')).toBe(2);

		// A matching device id under a different account is scoped by account_id and does not evict the other account's device.
		await store.savePushDevice({
			accountId: 'old-owner',
			deviceId: 'device-new00000000',
			endpoint: 'https://push.example/endpoint-c',
			...keys
		});
		expect(await store.countPushDevices('old-owner')).toBe(1);
		expect(await store.countPushDevices('new-owner')).toBe(2);

		// Deleting the shared device id under old-owner leaves new-owner's device and wake delivery intact.
		await store.deletePushDevice('old-owner', 'device-new00000000');
		expect(await store.countPushDevices('old-owner')).toBe(0);
		expect(await store.countPushDevices('new-owner')).toBe(2);

		await store.replaceReminderWakes('new-owner', [{ id: 'w'.repeat(43), fireAt: 1_000 }]);
		const due = await store.claimDueWakes(1_000, 100, 'new-owner');
		expect(due.map((w) => ({ deviceId: w.deviceId, endpoint: w.endpoint }))).toEqual([
			{ deviceId: 'device-new00000000', endpoint: 'https://push.example/endpoint-b' },
			{ deviceId: 'device-replaced000', endpoint: 'https://push.example/endpoint-a' }
		]);
	});

	it("claims at most an account's share of a round, leaving room for other accounts", async () => {
		for (const account of ['flood', 'other']) {
			await store.createAccount(account, 'credential');
			await store.savePushDevice({
				deviceId: `device-${account}`.padEnd(16, 'x'),
				endpoint: `https://push.example/${account}`,
				p256dh: 'p'.repeat(20),
				auth: 'a'.repeat(16),
				accountId: account
			});
		}
		await store.replaceReminderWakes(
			'flood',
			Array.from({ length: WAKE_CLAIM_ACCOUNT_LIMIT + 8 }, (_, index) => ({
				id: String(index).padStart(43, 'w'),
				fireAt: 1_000 + index
			}))
		);
		await store.replaceReminderWakes('other', [{ id: 'o'.repeat(43), fireAt: 2_000 }]);

		const claimed = await store.claimDueWakes(5_000, 100);

		expect(claimed.filter((w) => w.accountId === 'flood')).toHaveLength(WAKE_CLAIM_ACCOUNT_LIMIT);
		expect(claimed.filter((w) => w.accountId === 'other')).toHaveLength(1);
		expect((await store.claimDueWakes(5_000, 100)).map((w) => w.accountId)).toEqual(
			Array<string>(8).fill('flood')
		);
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

describe('Workers reminder wake publishing', () => {
	const wake = (letter: string, fireAt: number) => ({ id: letter.repeat(43), fireAt });
	const list = [wake('a', 1_000), wake('b', 5_000), wake('c', 9_000)];

	/** Every row written to `reminder_wakes` from here on, as SQLite counts them. */
	async function countWakeWrites(): Promise<() => Promise<number>> {
		await client.executeMultiple(`
			CREATE TABLE wake_writes (n INTEGER);
			CREATE TRIGGER wake_inserted AFTER INSERT ON reminder_wakes BEGIN INSERT INTO wake_writes VALUES (1); END;
			CREATE TRIGGER wake_updated AFTER UPDATE ON reminder_wakes BEGIN INSERT INTO wake_writes VALUES (1); END;
			CREATE TRIGGER wake_deleted AFTER DELETE ON reminder_wakes BEGIN INSERT INTO wake_writes VALUES (1); END;
		`);
		return async () =>
			Number((await client.execute('SELECT COUNT(*) AS n FROM wake_writes')).rows[0].n);
	}

	beforeEach(async () => {
		await store.createAccount('account', 'credential');
	});

	it('writes no wake rows for a newer revision with the same wakes, only the revision', async () => {
		await store.replaceReminderWakes('account', list, 1);
		await store.markReminderWakesScheduled('account', 1);
		const writes = await countWakeWrites();

		expect(await store.replaceReminderWakes('account', [...list].reverse(), 2)).toEqual({
			accepted: true,
			schedule: false
		});

		expect(await writes()).toBe(0);
		expect(await store.getReminderWakes('account')).toEqual({ revision: 2, wakes: list });
	});

	it('writes only the rows of the wake that changed', async () => {
		await store.replaceReminderWakes('account', list, 1);
		const writes = await countWakeWrites();

		const moved = [wake('a', 1_000), wake('b', 6_000), wake('c', 9_000)];
		expect((await store.replaceReminderWakes('account', moved, 2)).schedule).toBe(true);
		expect(await writes()).toBe(1);

		const added = [...moved, wake('d', 12_000)];
		await store.replaceReminderWakes('account', added, 3);
		expect(await writes()).toBe(2);

		await store.replaceReminderWakes('account', added.slice(1), 4);
		expect(await writes()).toBe(3);
		expect((await store.getReminderWakes('account')).wakes).toEqual(added.slice(1));
	});

	it('refuses a lower revision and changes nothing at an equal one', async () => {
		await store.replaceReminderWakes('account', list, 5);
		await store.markReminderWakesScheduled('account', 5);
		const writes = await countWakeWrites();

		expect(await store.replaceReminderWakes('account', [wake('z', 1)], 4)).toEqual({
			accepted: false,
			schedule: false
		});
		expect(await store.replaceReminderWakes('account', [wake('z', 1)], 5)).toEqual({
			accepted: true,
			schedule: false
		});

		expect(await writes()).toBe(0);
		expect(await store.getReminderWakes('account')).toEqual({ revision: 5, wakes: list });
	});

	it('keeps scheduling owed after a failed arm, even when the next publish is identical', async () => {
		expect((await store.replaceReminderWakes('account', list, 1)).schedule).toBe(true);
		// The arm failed, so nothing marked the change scheduled.
		expect((await store.replaceReminderWakes('account', list, 1)).schedule).toBe(true);
		expect((await store.replaceReminderWakes('account', list, 2)).schedule).toBe(true);

		await store.markReminderWakesScheduled('account', 2);
		expect((await store.replaceReminderWakes('account', list, 3)).schedule).toBe(false);
	});

	it('does not clear a newer change when an older arm finishes', async () => {
		await store.replaceReminderWakes('account', list, 1);
		await store.replaceReminderWakes('account', list.slice(1), 2);

		await store.markReminderWakesScheduled('account', 1);

		expect((await store.replaceReminderWakes('account', list.slice(1), 3)).schedule).toBe(true);
	});

	it('refuses wakes for an account that does not exist', async () => {
		expect(await store.replaceReminderWakes('missing', list, 1)).toEqual({
			accepted: false,
			schedule: false
		});
	});
});
