import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, testD1, testR2 } from './testBindings';

const bindings = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('./env', () => ({ cloudflareBindings: () => bindings.value }));

import { SyncStore, WAKE_CLAIM_ACCOUNT_LIMIT, WAKE_CLAIM_LEASE_MS } from './syncStore';

let store: SyncStore;
let client: ReturnType<typeof testD1>['client'];
let database: ReturnType<typeof testD1>['db'];

beforeEach(async () => {
	const d1 = testD1();
	client = d1.client;
	database = d1.db;
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

describe('Workers reminder wakes for a phone that shows reminders itself', () => {
	const DAY = 24 * 60 * 60 * 1000;
	const wake = (letter: string, fireAt: number) => ({ id: letter.repeat(43), fireAt });
	const phone = (accountId: string, deviceId = 'device-phone000000') => ({
		accountId,
		deviceId,
		endpoint: `apns://com.scrapscache.app/${'ab'.repeat(32)}/${accountId}`,
		p256dh: '',
		auth: ''
	});
	const ids = (...letters: string[]) => letters.map((letter) => letter.repeat(43));
	const due = async (now: number) =>
		(await store.claimDueWakes(now)).map((claimed) => claimed.wakeId);
	const holds = async () =>
		Number((await client.execute('SELECT COUNT(*) AS held FROM reminder_wake_holds')).rows[0].held);

	it('is not sent a wake it holds, nor one already due when it registers', async () => {
		await store.createAccount('account', 'credential');
		await store.replaceReminderWakes(
			'account',
			[wake('a', 1_000), wake('b', 5_000), wake('c', 9_000)],
			1
		);
		await store.savePushDevice(phone('account'), { held: ids('b'), now: 2_000 });
		expect(await store.nextWakeAt(2_000)).toBe(9_000);
		expect(await due(9_000)).toEqual(ids('c'));
	});

	it('is sent a wake it held once it no longer holds it, but never one already pushed', async () => {
		await store.createAccount('account', 'credential');
		await store.replaceReminderWakes(
			'account',
			[wake('a', 1_000), wake('b', 5_000), wake('c', 9_000)],
			1
		);
		await store.savePushDevice(phone('account'), { held: [], now: 0 });
		const [sent] = await store.claimDueWakes(1_000);
		await store.markWakeDelivered(sent, 1_000);
		await store.savePushDevice(phone('account'), { held: ids('b', 'c'), now: 1_500 });
		await store.savePushDevice(phone('account'), { held: ids('c'), now: 1_600 });
		expect(await due(9_000)).toEqual(ids('b'));
	});

	it('follows what the phone holds for wakes the relay has not heard of yet', async () => {
		await store.createAccount('account', 'credential');
		await store.savePushDevice(phone('account'), { held: ids('b', 'c'), now: 100 });
		// It lets go of `c` before any device publishes either wake.
		await store.savePushDevice(phone('account'), { held: ids('b'), now: 200 });
		await store.replaceReminderWakes('account', [wake('b', 5_000), wake('c', 5_000)], 1);
		expect(await due(5_000)).toEqual(ids('c'));
	});

	it('still holds a reminder days away after the delivery history is pruned', async () => {
		await store.createAccount('account', 'credential');
		await store.replaceReminderWakes('account', [wake('b', 2 * DAY)], 1);
		await store.savePushDevice(phone('account'), { held: ids('b'), now: 0 });
		await store.pruneStaleWakes(DAY + 60_000);
		expect(await due(2 * DAY)).toEqual([]);
		expect(await store.nextWakeAt(2 * DAY)).toBeNull();
	});

	it('keeps only the holds a phone last named, and none for a device that is gone or replaced', async () => {
		await store.createAccount('account', 'credential');
		await store.createAccount('other', 'credential');
		await store.savePushDevice(phone('other', 'device-other000000'), { held: ids('z'), now: 100 });
		await store.savePushDevice(phone('account', 'device-before00000'), {
			held: ids('x', 'y'),
			now: 100
		});
		for (const letters of [
			['a', 'b', 'c'],
			['d', 'e']
		]) {
			await store.savePushDevice(phone('account'), { held: ids(...letters), now: 200 });
		}
		// The replaced device's two are gone; the phone's last two and the other account's one stay.
		expect(await holds()).toBe(3);
		await store.deletePushDevice('account', 'device-phone000000');
		expect(await holds()).toBe(1);
	});

	it('takes a phone off one account by its push address, with its holds, and off no other', async () => {
		for (const accountId of ['account', 'other']) {
			await store.createAccount(accountId, 'credential');
			await store.savePushDevice(phone(accountId), { held: ids('b'), now: 0 });
		}
		// A token that is not this account's phone removes nothing.
		await store.deletePushEndpoint(
			'account',
			`apns://com.scrapscache.app/${'cd'.repeat(32)}/account`
		);
		expect(await store.countPushDevices('account')).toBe(1);
		await store.deletePushEndpoint('account', phone('account').endpoint);
		expect(await store.countPushDevices('account')).toBe(0);
		expect(await store.countPushDevices('other')).toBe(1);
		expect(await holds()).toBe(1);
	});

	it('says a claimed wake is no longer owed once the phone holds it, was sent it, the reminder is withdrawn, or the phone is gone', async () => {
		await store.createAccount('account', 'credential');
		const three = [wake('a', 1_000), wake('b', 1_000), wake('c', 1_000)];
		await store.replaceReminderWakes('account', [...three, wake('d', 1_000)], 1);
		await store.savePushDevice(phone('account'), { held: [], now: 0 });
		const [first, second, third, fourth] = await store.claimDueWakes(1_000);
		expect(await store.isWakeOwed(first)).toBe(true);
		await store.markWakeDelivered(first, 1_000);
		expect(await store.isWakeOwed(first)).toBe(false);
		// The app opens before the second is sent, and takes it as its own.
		await store.savePushDevice(phone('account'), { held: ids('b'), now: 500 });
		expect(await store.isWakeOwed(second)).toBe(false);
		// The fourth reminder is deleted on another device before its push is sent.
		expect(await store.isWakeOwed(fourth)).toBe(true);
		await store.replaceReminderWakes('account', three, 2);
		expect(await store.isWakeOwed(fourth)).toBe(false);
		expect(await store.isWakeOwed(third)).toBe(true);
		await store.deletePushDevice('account', 'device-phone000000');
		expect(await store.isWakeOwed(third)).toBe(false);
	});

	it('does not send what a phone took as delivered between a claim being read and written', async () => {
		await store.createAccount('account', 'credential');
		await store.replaceReminderWakes('account', [wake('a', 1_000)], 1);
		await store.savePushDevice(phone('account'), { held: [], now: 0 });
		// On Workers the claim reads the due wakes, then writes its claims in a second
		// step. Here the phone's app opens in between and registers again.
		let between: (() => Promise<void>) | null = () =>
			store.savePushDevice(phone('account'), { held: [], now: 1_000 });
		const racing = {
			batch: database.batch,
			prepare: (sql: string) => {
				const statement = database.prepare(sql);
				if (!sql.includes('accountRank')) return statement;
				return {
					bind: (...args: unknown[]) => ({
						run: async () => {
							const result = await statement.bind(...args).run();
							const registration = between;
							between = null;
							await registration?.();
							return result;
						}
					})
				};
			}
		};
		bindings.value = { SCRAPSCACHE_DB: racing, SCRAPSCACHE_ENVELOPES: testR2().bucket };
		const [claimed] = await new SyncStore().claimDueWakes(1_000);
		expect(claimed.wakeId).toBe('a'.repeat(43));
		expect(await store.isWakeOwed(claimed)).toBe(false);
		expect(await due(1_000 + WAKE_CLAIM_LEASE_MS)).toEqual([]);
	});

	it('keeps one push token under two accounts as two devices', async () => {
		await store.createAccount('account', 'credential');
		await store.createAccount('other', 'credential');
		await store.replaceReminderWakes('account', [wake('b', 5_000)], 1);
		await store.replaceReminderWakes('other', [wake('b', 5_000)], 1);
		await store.savePushDevice(phone('account'), { held: ids('b'), now: 100 });
		await store.savePushDevice(phone('other', 'device-other000000'), { held: [], now: 100 });
		expect((await store.claimDueWakes(5_000)).map((claimed) => claimed.deviceId)).toEqual([
			'device-other000000'
		]);
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
