// Self-hosted: one in-process timer for the next reminder wake of any account, so
// each is delivered at its own time. It arms itself when the server starts.
import { dispatchDueWakes } from '$lib/server/wakeDispatch';

/** setTimeout's largest delay; a later wake is re-armed when this one fires. */
const MAX_DELAY_MS = 2 ** 31 - 1;

let timer: ReturnType<typeof setTimeout> | null = null;
let armedFor: number | null = null;
let running = false;
let rerun: number | null = null;

/**
 * Deliver wakes at `at`, unless a timer for an earlier time is already set. One
 * timer serves every account on this server, so the account is not needed.
 */
export async function armWakeTimer(_accountId: string, at: number): Promise<void> {
	arm(at);
}

/** After delivering: the timer already follows on to the next wake by itself. */
export async function rescheduleWakeTimer(
	_accountId: string,
	next: number | null,
	_generation: number
): Promise<void> {
	if (next !== null) arm(next);
}

/** Pick up wakes stored before the server started. */
export async function startWakeTimer(): Promise<void> {
	arm(Date.now());
}

function arm(at: number): void {
	if (running) {
		// Delivery in progress: run again after it, no later than asked.
		rerun = rerun === null ? at : Math.min(rerun, at);
		return;
	}
	if (timer && armedFor !== null && armedFor <= at) return;
	if (timer) clearTimeout(timer);
	armedFor = at;
	const delay = Math.min(Math.max(at - Date.now(), 0), MAX_DELAY_MS);
	timer = setTimeout(() => void fire(at), delay);
	(timer as { unref?: () => void }).unref?.();
}

async function fire(at: number): Promise<void> {
	timer = null;
	armedFor = null;
	if (at > Date.now()) {
		arm(at);
		return;
	}
	running = true;
	let next: number | null = null;
	try {
		next = (await dispatchDueWakes()).next;
	} catch (error) {
		console.error(
			JSON.stringify({
				level: 'error',
				event: 'wake_dispatch_failed',
				message: error instanceof Error ? error.message : 'Wake dispatch failed'
			})
		);
		// The store failed, not a push: try again shortly.
		next = Date.now() + 60_000;
	} finally {
		running = false;
	}
	const again = rerun;
	rerun = null;
	for (const time of [next, again]) if (time !== null) arm(time);
}

/** Tests only: forget the armed timer. */
export function resetWakeTimer(): void {
	if (timer) clearTimeout(timer);
	timer = null;
	armedFor = null;
	running = false;
	rerun = null;
}

export async function beginWakeDelivery(_accountId: string): Promise<number> {
	return 0;
}
