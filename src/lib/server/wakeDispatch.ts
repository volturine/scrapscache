import { Effect } from 'effect';
import {
	getSyncStore,
	WAKE_CLAIM_ACCOUNT_LIMIT,
	WAKE_CLAIM_LEASE_MS,
	type DueWake,
	type SyncStore
} from '#lib/server/syncStore.js';
import { sendReminderTick, type WakeSendResult } from '#lib/server/webPush.js';
import { recordReminderWake } from '#lib/server/metrics.js';

const SEND_CONCURRENCY = 8;
/**
 * Wakes claimed per round, at most `WAKE_CLAIM_ACCOUNT_LIMIT` of any one
 * account's. A full round, or an account's full share, means more may be due.
 */
const CLAIM_LIMIT = 100;
/** Rounds per dispatch. What is still due after them is sent by the next dispatch, at once. */
const MAX_ROUNDS = 10;
/** Longest wait between attempts for a device whose push keeps failing. */
const MAX_RETRY_DELAY_MS = 30 * 60_000;

/**
 * A failed send waits about as long as its wake is already overdue: a minute at
 * first, doubling with each failure, at most half an hour.
 */
function wakeRetryAt(fireAt: number, now: number): number {
	return now + Math.min(Math.max(now - fireAt, WAKE_CLAIM_LEASE_MS), MAX_RETRY_DELAY_MS);
}

export type WakeSender = (device: DueWake) => Promise<WakeSendResult>;
export type WakeDispatchResult = {
	sent: number;
	failed: number;
	gone: number;
	/**
	 * When the next dispatch is needed: now while some are still due, when a
	 * failed send is retried, or the next wake's time.
	 */
	next: number | null;
};

/** Whether some account was handed its whole share of the round. */
function accountHitShare(due: DueWake[]): boolean {
	const claimed = new Map<string, number>();
	for (const device of due) {
		const count = (claimed.get(device.accountId) ?? 0) + 1;
		if (count >= WAKE_CLAIM_ACCOUNT_LIMIT) return true;
		claimed.set(device.accountId, count);
	}
	return false;
}

function earliest(...times: (number | null)[]): number | null {
	const known = times.filter((time): time is number => time !== null);
	return known.length ? Math.min(...known) : null;
}

/**
 * Deliver every wake due now, of one account when `accountId` is given, and say
 * when to run again. A failed send is retried with backoff; a push endpoint the
 * push service no longer knows is dropped.
 */
export async function dispatchDueWakes(
	options: { store?: SyncStore; send?: WakeSender; now?: () => number; accountId?: string } = {}
): Promise<WakeDispatchResult> {
	const store = options.store ?? getSyncStore();
	const send = options.send ?? sendReminderTick;
	const now = options.now ?? Date.now;
	const result: WakeDispatchResult = { sent: 0, failed: 0, gone: 0, next: null };
	let moreDue = false;

	// A store write that fails ends the dispatch with the store's own error, which
	// the caller logs and retries; a send that fails only defers its own wake.
	const write = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (e) => e });
	const deliver = (device: DueWake) =>
		Effect.gen(function* () {
			const outcome = yield* Effect.tryPromise(() => send(device)).pipe(
				Effect.orElseSucceed((): WakeSendResult => 'failed')
			);
			if (outcome === 'failed') {
				yield* write(() => store.deferWakeRetry(device, wakeRetryAt(Number(device.fireAt), now())));
			} else if (outcome === 'gone') {
				yield* write(() => store.deletePushDevice(device.accountId, device.deviceId));
			} else {
				yield* write(() => store.markWakeDelivered(device, now()));
			}
			recordReminderWake(outcome);
			result[outcome] += 1;
		});

	for (let round = 0; round < MAX_ROUNDS; round += 1) {
		const due = await store.claimDueWakes(now(), CLAIM_LIMIT, options.accountId);
		// A slow push service holds up only its own slot, not a whole batch.
		await Effect.runPromise(
			Effect.forEach(due, deliver, { concurrency: SEND_CONCURRENCY, discard: true })
		);
		moreDue = due.length === CLAIM_LIMIT || accountHitShare(due);
		if (!moreDue) break;
	}
	// A deferred claim counts from its retry time, so the next wake covers retries.
	result.next = earliest(moreDue ? now() : null, await store.nextWakeAt(now(), options.accountId));
	return result;
}
