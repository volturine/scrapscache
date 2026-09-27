// Workers: each account's reminder scheduler, a Durable Object in the separate
// reminders Worker, holds an alarm for that account's next wake. When it fires,
// the scheduler queues the account and this Worker delivers its due wakes.
import { cloudflareBindings } from './env';

async function callScheduler(
	path: '/arm' | '/set' | '/begin',
	accountId: string,
	at: number | null,
	generation?: number
): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> {
	const namespace = cloudflareBindings().REMINDER_SCHEDULER;
	const scheduler = namespace.get(namespace.idFromName(accountId));
	const response = await scheduler.fetch(`https://reminder-scheduler${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ accountId, at, generation })
	});
	if (!response.ok) throw new Error(`Reminder scheduler failed with HTTP ${response.status}`);
	return response;
}

/** Deliver an account's wakes at `at`, unless its alarm is already set earlier. */
export function armWakeTimer(accountId: string, at: number): Promise<void> {
	return callScheduler('/arm', accountId, at).then(() => undefined);
}

/**
 * After delivering an account's wakes: its next delivery is at `next`, or none.
 * This replaces the retry its scheduler set when it handed the account over.
 */
export function rescheduleWakeTimer(
	accountId: string,
	next: number | null,
	generation: number
): Promise<void> {
	return callScheduler('/set', accountId, next, generation).then(() => undefined);
}

/** Alarms live in the scheduler's storage and survive restarts; nothing to start. */
export async function startWakeTimer(): Promise<void> {}

/** Tests only; nothing to reset on Workers. */
export function resetWakeTimer(): void {}

/** A completion may only replace alarms observed before this delivery began. */
export async function beginWakeDelivery(accountId: string): Promise<number> {
	const response = await callScheduler('/begin', accountId, null);
	return ((await response.json()) as { generation: number }).generation;
}
