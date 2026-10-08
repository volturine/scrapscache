import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupTestDbs, testDb } from '#lib/server/testDb.js';
import {
	SyncStore,
	WAKE_CLAIM_ACCOUNT_LIMIT,
	WAKE_CLAIM_LEASE_MS,
	type DueWake
} from '#lib/server/syncStore.js';
import { dispatchDueWakes } from './wakeDispatch';

vi.mock('#lib/server/metrics.js', async (original) => ({
	...(await original<typeof import('#lib/server/metrics.js')>()),
	recordReminderWake: vi.fn()
}));

afterEach(() => cleanupTestDbs());

const wake = (index: number, fireAt: number) => ({
	id: String(index).padStart(43, 'w'),
	fireAt
});

async function account(store: SyncStore, id: string, wakes: { id: string; fireAt: number }[]) {
	await store.createAccount(id, 'credential');
	await store.savePushDevice({
		accountId: id,
		deviceId: `device-${id}`.padEnd(16, 'x'),
		endpoint: `https://push.example/${id}`,
		p256dh: 'p'.repeat(20),
		auth: 'a'.repeat(16)
	});
	await store.replaceReminderWakes(id, wakes);
}

describe('delivering reminder wakes', () => {
	it("delivers only the account's own wakes and says when its next one is due", async () => {
		const store = new SyncStore(testDb());
		await account(store, 'account-aaaaaaaaaaaa', [wake(1, 1_000), wake(2, 9_000)]);
		await account(store, 'account-bbbbbbbbbbbb', [wake(3, 1_000), wake(4, 5_000)]);
		const sent: DueWake[] = [];

		const result = await dispatchDueWakes({
			store,
			accountId: 'account-aaaaaaaaaaaa',
			now: () => 2_000,
			send: async (device) => {
				sent.push(device);
				return 'sent';
			}
		});

		expect(sent.map((device) => device.accountId)).toEqual(['account-aaaaaaaaaaaa']);
		expect(result).toEqual({ sent: 1, failed: 0, gone: 0, next: 9_000 });
	});

	it('delivers every wake due at the same moment, however many there are', async () => {
		const store = new SyncStore(testDb());
		await account(
			store,
			'account-aaaaaaaaaaaa',
			Array.from({ length: 250 }, (_, index) => wake(index, 60_000))
		);
		const send = vi.fn(async () => 'sent' as const);

		const result = await dispatchDueWakes({ store, now: () => 60_000, send });

		expect(send).toHaveBeenCalledTimes(250);
		expect(result.next).toBeNull();
		// 250 wakes through a real store: allow for a busy CI runner.
	}, 30_000);

	it('shares a round between accounts instead of serving one flood first', async () => {
		const store = new SyncStore(testDb());
		await account(
			store,
			'account-aaaaaaaaaaaa',
			Array.from({ length: WAKE_CLAIM_ACCOUNT_LIMIT + 8 }, (_, index) => wake(index, 1_000))
		);
		await account(store, 'account-bbbbbbbbbbbb', [wake(999, 1_500)]);
		const sent: string[] = [];

		const result = await dispatchDueWakes({
			store,
			now: () => 2_000,
			send: async (device) => {
				sent.push(device.accountId);
				return 'sent';
			}
		});

		// The other account's wake goes out in the first round, not after the flood.
		expect(sent.indexOf('account-bbbbbbbbbbbb')).toBeLessThanOrEqual(WAKE_CLAIM_ACCOUNT_LIMIT);
		expect(result).toMatchObject({ sent: WAKE_CLAIM_ACCOUNT_LIMIT + 9, failed: 0, next: null });
	});

	it('comes back for a failed send once its claim lease runs out', async () => {
		const store = new SyncStore(testDb());
		await account(store, 'account-aaaaaaaaaaaa', [wake(1, 1_000), wake(2, 900_000)]);

		const result = await dispatchDueWakes({
			store,
			now: () => 2_000,
			send: async () => 'failed'
		});

		expect(result).toMatchObject({ failed: 1, next: 2_000 + WAKE_CLAIM_LEASE_MS });
	});
	it('defers a send that throws, without failing the rest of the dispatch', async () => {
		const store = new SyncStore(testDb());
		await account(store, 'account-aaaaaaaaaaaa', [wake(1, 1_000)]);
		await account(store, 'account-bbbbbbbbbbbb', [wake(2, 1_000)]);

		const result = await dispatchDueWakes({
			store,
			now: () => 2_000,
			send: async (device) => {
				if (device.accountId === 'account-aaaaaaaaaaaa') throw new Error('push service down');
				return 'sent';
			}
		});

		expect(result).toMatchObject({ sent: 1, failed: 1, gone: 0 });
	});

	it("fails with the store's own error when a delivery cannot be recorded", async () => {
		const store = new SyncStore(testDb());
		await account(store, 'account-aaaaaaaaaaaa', [wake(1, 1_000)]);
		vi.spyOn(store, 'markWakeDelivered').mockRejectedValue(new Error('SQLITE_BUSY: locked'));

		await expect(
			dispatchDueWakes({ store, now: () => 2_000, send: async () => 'sent' })
		).rejects.toThrow('SQLITE_BUSY: locked');
	});

	it('keeps other sends going while one push service is slow', async () => {
		const store = new SyncStore(testDb());
		const ids = Array.from(
			{ length: 12 },
			(_, index) => `account-${String(index).padStart(12, 'a')}`
		);
		for (const [index, id] of ids.entries()) await account(store, id, [wake(index, 1_000)]);
		let release!: () => void;
		const slow = new Promise<void>((resolve) => (release = resolve));
		const started: string[] = [];

		const dispatch = dispatchDueWakes({
			store,
			now: () => 2_000,
			send: async (device) => {
				started.push(device.accountId);
				if (started.length === 1) await slow;
				return 'sent';
			}
		});
		await vi.waitFor(() => expect(started).toHaveLength(12));
		release();

		expect(await dispatch).toMatchObject({ sent: 12, failed: 0 });
	});

	it('backs off a device whose push keeps failing, up to half an hour', async () => {
		const store = new SyncStore(testDb());
		await account(store, 'account-aaaaaaaaaaaa', [wake(1, 1_000)]);
		const send = vi.fn(async () => 'failed' as const);
		let clock = 1_000 + 10 * 60_000;
		const first = await dispatchDueWakes({ store, now: () => clock, send });
		expect(first.next).toBe(clock + 10 * 60_000);
		// Not retried before its time.
		clock += 10 * 60_000 - 1;
		expect((await dispatchDueWakes({ store, now: () => clock, send })).failed).toBe(0);
		clock = 1_000 + 5 * 60 * 60_000;
		const later = await dispatchDueWakes({ store, now: () => clock, send });
		expect(later).toMatchObject({ failed: 1, next: clock + 30 * 60_000 });
		expect(send).toHaveBeenCalledTimes(2);
	});
	it('rearms immediately for a wake becoming due during a partial batch', async () => {
		const store = new SyncStore(testDb());
		await account(store, 'account-aaaaaaaaaaaa', [wake(1, 1000), wake(2, 1500)]);
		let clock = 1000;
		const result = await dispatchDueWakes({
			store,
			now: () => clock,
			send: async () => {
				clock = 2000;
				return 'sent';
			}
		});
		expect(result.next).toBe(2000);
		expect(
			(await dispatchDueWakes({ store, now: () => clock, send: async () => 'sent' })).sent
		).toBe(1);
	});
	it('rearms for a lease held by an interrupted delivery', async () => {
		const store = new SyncStore(testDb());
		await account(store, 'account-aaaaaaaaaaaa', [wake(1, 1000)]);
		await store.claimDueWakes(1000);
		const result = await dispatchDueWakes({ store, now: () => 2000, send: async () => 'sent' });
		expect(result).toMatchObject({ sent: 0, next: 1000 + WAKE_CLAIM_LEASE_MS });
	});
});
