import { describe, expect, it, vi } from 'vitest';
import { ReminderScheduler, RETRY_AFTER_MS } from '../../../../cf/reminders';

function scheduler() {
	let alarm: number | null = null;
	const stored = new Map<string, unknown>();
	const storage = {
		get: async (key: string) => stored.get(key),
		put: async (key: string, value: unknown) => void stored.set(key, value),
		getAlarm: async () => alarm,
		setAlarm: async (at: number) => {
			alarm = at;
		},
		deleteAlarm: async () => {
			alarm = null;
		}
	};
	const queue = { send: vi.fn(async () => undefined) };
	let chain: Promise<unknown> = Promise.resolve();
	const blockConcurrencyWhile = <T>(run: () => Promise<T>) => {
		const next = chain.then(run);
		chain = next.catch(() => undefined);
		return next;
	};
	const object = new ReminderScheduler(
		{ storage, blockConcurrencyWhile } as never,
		{ WAKE_QUEUE: queue } as never
	);
	const call = (path: string, body: unknown) =>
		object.fetch(
			new Request(`https://reminder-scheduler${path}`, {
				method: 'POST',
				body: JSON.stringify({ generation: stored.get('generation'), ...(body as object) })
			})
		);
	return { object, queue, call, alarm: () => alarm };
}

describe("an account's reminder scheduler", () => {
	it('keeps the earliest time it is asked to run by', async () => {
		const { call, alarm } = scheduler();
		expect((await call('/arm', { accountId: 'account', at: 120_000 })).status).toBe(204);
		await call('/arm', { accountId: 'account', at: 60_000 });
		await call('/arm', { accountId: 'account', at: 180_000 });
		expect(alarm()).toBe(60_000);
		expect((await call('/arm', { accountId: 'account', at: 'soon' })).status).toBe(400);
		expect((await call('/arm', { at: 1 })).status).toBe(400);
	});

	it('hands the account to the app when the alarm fires, and comes back if nothing follows', async () => {
		vi.useFakeTimers({ now: 1_000_000 });
		const { object, call, queue, alarm } = scheduler();
		await call('/arm', { accountId: 'account', at: 1_000_000 });

		await object.alarm();

		expect(queue.send).toHaveBeenCalledWith({ accountId: 'account' });
		expect(alarm()).toBe(1_000_000 + RETRY_AFTER_MS);
		vi.useRealTimers();
	});

	it("takes the account's next wake from the app after it delivered, or stops", async () => {
		const { call, alarm } = scheduler();
		await call('/arm', { accountId: 'account', at: 5_000 });
		await call('/set', { accountId: 'account', at: 900_000 });
		expect(alarm()).toBe(900_000);
		await call('/set', { accountId: 'account', at: null });
		expect(alarm()).toBeNull();
	});

	it('keeps the next wake the app set while the account was being handed over', async () => {
		vi.useFakeTimers({ now: 1_000_000 });
		const { object, call, queue, alarm } = scheduler();
		await call('/arm', { accountId: 'account', at: 1_000_000 });
		queue.send.mockImplementationOnce(async () => {
			await call('/set', { accountId: 'account', at: 1_060_000 });
		});

		await object.alarm();

		expect(alarm()).toBe(1_060_000);
		vi.useRealTimers();
	});

	it('does nothing on an alarm before it knows its account', async () => {
		const { object, queue } = scheduler();
		await object.alarm();
		expect(queue.send).not.toHaveBeenCalled();
	});
	it('does not let a stale completion erase a newer arm or delivery', async () => {
		const { call, alarm, object } = scheduler();
		await call('/arm', { accountId: 'account', at: 100 });
		const { generation } = (await (await call('/begin', { accountId: 'account' })).json()) as {
			generation: number;
		};
		await call('/arm', { accountId: 'account', at: 50 });
		await object.fetch(
			new Request('https://scheduler.test/set', {
				method: 'POST',
				body: JSON.stringify({ accountId: 'account', at: null, generation })
			})
		);
		expect(alarm()).toBe(50);
		await call('/begin', { accountId: 'account' });
		await object.fetch(
			new Request('https://scheduler.test/set', {
				method: 'POST',
				body: JSON.stringify({ accountId: 'account', at: 999999, generation })
			})
		);
		expect(alarm()).toBe(50);
	});
	it('serializes simultaneous arms so the earliest one wins', async () => {
		const { call, alarm } = scheduler();
		await Promise.all([
			call('/arm', { accountId: 'account', at: 10 }),
			call('/arm', { accountId: 'account', at: 20 })
		]);
		expect(alarm()).toBe(10);
	});
});
