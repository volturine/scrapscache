import {
	getSyncStore,
	WAKE_CLAIM_LEASE_MS,
	type DueWake,
	type SyncStore
} from '$lib/server/syncStore';
import { sendReminderTick, type WakeSendResult } from '$lib/server/webPush';
import { recordReminderWake } from '$lib/server/metrics';

const SEND_CONCURRENCY = 8;
/** Wakes claimed per round. A full round means more may be due. */
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
	for (let round = 0; round < MAX_ROUNDS; round += 1) {
		const due = await store.claimDueWakes(now(), CLAIM_LIMIT, options.accountId);
		for (let offset = 0; offset < due.length; offset += SEND_CONCURRENCY) {
			const batch = due.slice(offset, offset + SEND_CONCURRENCY);
			const results = await Promise.all(
				batch.map((device) =>
					Promise.resolve()
						.then(() => send(device))
						.catch((): WakeSendResult => 'failed')
				)
			);
			for (const [index, device] of batch.entries()) {
				const sendResult = results[index];
				if (sendResult === 'failed') {
					await store.deferWakeRetry(device, wakeRetryAt(Number(device.fireAt), now()));
					recordReminderWake('failed');
					result.failed += 1;
					continue;
				}
				if (sendResult === 'gone') {
					await store.deletePushDevice(device.accountId, device.deviceId);
					recordReminderWake('gone');
					result.gone += 1;
					continue;
				}
				await store.markWakeDelivered(device, now());
				recordReminderWake('sent');
				result.sent += 1;
			}
		}
		moreDue = due.length === CLAIM_LIMIT;
		if (!moreDue) break;
	}
	// A deferred claim counts from its retry time, so the next wake covers retries.
	result.next = earliest(moreDue ? now() : null, await store.nextWakeAt(now(), options.accountId));
	return result;
}
