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

/** The wait before retry number `retry` (counting from 0), in milliseconds. */
export function backoffDelay(backoff: Backoff, retry: number, random = Math.random): number {
	const step = Math.min(backoff.base * backoff.factor ** retry, backoff.max);
	return step * (0.8 + 0.4 * random());
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
 * Run `attempt` again for as long as `backoff` allows while its result is
 * `transient`. The last result is returned either way, so a caller sees the same
 * shape of answer whether or not a retry happened.
 */
export async function retryTransient<A>(
	attempt: () => Promise<A>,
	transient: (result: A) => boolean,
	backoff: Backoff = transientRetry
): Promise<A> {
	let result = await attempt();
	for (let retry = 0; transient(result) && retry < (backoff.times ?? Infinity); retry += 1) {
		await wait(backoffDelay(backoff, retry));
		result = await attempt();
	}
	return result;
}
