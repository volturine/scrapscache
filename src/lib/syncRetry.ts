// Retry timing for talking to the relay. Each delay is an exponential step capped
// at `max`, then varied by ±20%: every device that lost the relay at the same
// moment would otherwise come back at the same moment, the cap included.

export interface Backoff {
	/** The first delay, in milliseconds. */
	base: number;
	factor: number;
	/** The longest step, in milliseconds, before variation. */
	max: number;
	/** How many retries the backoff allows; unlimited when absent. */
	times?: number;
}

/** A request the relay never answered, or could not serve: about 0.5, 1 and 2 seconds apart. */
export const transientRetry: Backoff = { base: 500, factor: 2, max: 5_000, times: 3 };

/** Live sync events: from 2 seconds, half again longer each time, at most 30 seconds. */
export const reconnectBackoff: Backoff = { base: 2_000, factor: 1.5, max: 30_000 };

/** A save to this device's database that failed: from 1 second, doubling, at most 30 seconds. */
export const saveRetry: Backoff = { base: 1_000, factor: 2, max: 30_000 };

/** Reminder receipts the relay did not take: from 2 seconds, doubling, at most 30 seconds. */
export const receiptRetry: Backoff = { base: 2_000, factor: 2, max: 30_000 };

/** The wait before retry number `retry` (counting from 0), in milliseconds. */
export function backoffDelay(backoff: Backoff, retry: number, random = Math.random): number {
	const step = Math.min(backoff.base * backoff.factor ** retry, backoff.max);
	return step * (0.8 + 0.4 * random());
}

/**
 * How long the relay may stay silent before a request to it is given up. On a
 * connection that is up in name only nothing arrives and nothing fails, so without
 * this a sync would wait for as long as the browser does.
 */
export const RELAY_SILENCE_MS = 60_000;

/** What a request given up for the relay's silence fails with. */
export const SYNC_TIMED_OUT = 'Sync timed out';

/**
 * Run `request` with a signal that aborts when `signal` does, or once the relay
 * has taken `ms`: a request it never answers is given up instead of waited for.
 */
export async function withinTime<T>(
	ms: number,
	signal: AbortSignal | null | undefined,
	request: (signal: AbortSignal) => Promise<T>
): Promise<T> {
	const limit = new AbortController();
	const giveUp = () => limit.abort(signal?.reason);
	if (signal?.aborted) giveUp();
	signal?.addEventListener('abort', giveUp, { once: true });
	const timer = setTimeout(() => limit.abort(new Error(SYNC_TIMED_OUT)), ms);
	try {
		return await request(limit.signal);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', giveUp);
	}
}

/** Resolve after `ms`, or as soon as `signal` aborts. */
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve();
		const done = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		signal?.addEventListener('abort', done, { once: true });
	});
}

/**
 * `work`, unless `signal` aborts first: the wait then ends with the signal's
 * reason, and whatever `work` settles to later is dropped.
 */
export function untilAborted<T>(work: Promise<T>, signal?: AbortSignal | null): Promise<T> {
	if (!signal) return work;
	return new Promise<T>((resolve, reject) => {
		const aborted = () => reject(signal.reason);
		signal.addEventListener('abort', aborted, { once: true });
		// Always heard out, so work that fails after the wait ended is not left unhandled.
		void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
		if (signal.aborted) aborted();
	});
}

/**
 * Run `attempt` again for as long as `backoff` allows while its result is
 * `transient`. The last result is returned either way, so a caller sees the same
 * shape of answer whether or not a retry happened. Aborting `signal` ends the
 * wait before a retry at once; `attempt` and `transient` decide what follows.
 */
export async function retryTransient<A>(
	attempt: () => Promise<A>,
	transient: (result: A) => boolean,
	backoff: Backoff = transientRetry,
	signal?: AbortSignal
): Promise<A> {
	let result = await attempt();
	for (let retry = 0; transient(result) && retry < (backoff.times ?? Infinity); retry += 1) {
		await wait(backoffDelay(backoff, retry), signal);
		result = await attempt();
	}
	return result;
}

/**
 * Work that failed and is tried again by itself, by what it is for: one wait per
 * key, longer after each failure in a row, until an attempt `succeeded`.
 */
export class Retries {
	private waits = new Map<
		string,
		{ timer: ReturnType<typeof setTimeout> | null; failures: number; again: () => void }
	>();

	constructor(private readonly backoff: Backoff) {}

	/** `key` is being tried now: a wait for it is over, and what it has failed so far still counts. */
	trying(key: string): void {
		const wait = this.waits.get(key);
		if (!wait?.timer) return;
		clearTimeout(wait.timer);
		wait.timer = null;
	}

	/** `key` failed: run `again` after its next wait. During a wait, only what runs is replaced. */
	failed(key: string, again: () => void): void {
		const wait = this.waits.get(key) ?? { timer: null, failures: 0, again };
		this.waits.set(key, wait);
		wait.again = again;
		if (wait.timer !== null) return;
		wait.timer = setTimeout(
			() => {
				wait.timer = null;
				wait.again();
			},
			backoffDelay(this.backoff, wait.failures)
		);
		wait.failures += 1;
	}

	/**
	 * An attempt at `key` got through: its next failure starts over. A wait that a
	 * later failure of the same key started meanwhile stands, as that one's first.
	 */
	succeeded(key: string): void {
		const wait = this.waits.get(key);
		if (!wait) return;
		if (wait.timer === null) this.waits.delete(key);
		else wait.failures = 1;
	}

	/** `key` is no longer wanted: nothing waits for it, and its next failure starts over. */
	settled(key: string): void {
		const wait = this.waits.get(key);
		if (wait?.timer) clearTimeout(wait.timer);
		this.waits.delete(key);
	}

	/** Every key is settled. */
	clear(): void {
		for (const wait of this.waits.values()) if (wait.timer) clearTimeout(wait.timer);
		this.waits.clear();
	}
}
