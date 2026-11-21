import { describe, expect, it, vi } from 'vitest';
import {
	backoffDelay,
	reconnectBackoff,
	retryTransient,
	transientRetry,
	untilAborted,
	wait,
	withinTime,
	type Backoff
} from './syncRetry';

/** The delays a backoff asks for, in milliseconds, until it ends or `limit` is reached. */
function delays(backoff: Backoff, limit = 12, random = Math.random): number[] {
	const count = Math.min(limit, backoff.times ?? Infinity);
	return Array.from({ length: count }, (_, retry) => backoffDelay(backoff, retry, random));
}

function within(actual: number, expected: number): void {
	expect(actual).toBeGreaterThanOrEqual(expected * 0.8 - 1);
	expect(actual).toBeLessThanOrEqual(expected * 1.2 + 1);
}

describe('relay retry timing', () => {
	it('grows exponentially up to the cap and varies every delay, the capped ones too', () => {
		const steps = delays({ base: 100, factor: 2, max: 1_000 }, 8);
		expect(steps).toHaveLength(8);
		steps.forEach((delay, index) => within(delay, Math.min(100 * 2 ** index, 1000)));
		expect(backoffDelay({ base: 100, factor: 2, max: 1_000 }, 7, () => 0)).toBeCloseTo(800);
		expect(backoffDelay({ base: 100, factor: 2, max: 1_000 }, 7, () => 1)).toBeCloseTo(1_200);
	});

	it('retries a transient sync failure three times, about 0.5, 1 and 2 seconds apart', () => {
		const steps = delays(transientRetry);
		expect(steps).toHaveLength(3);
		steps.forEach((delay, index) => within(delay, 500 * 2 ** index));
	});

	it('reconnects live events from 2 seconds up to at most 30, indefinitely', () => {
		const steps = delays(reconnectBackoff, 12);
		expect(steps).toHaveLength(12);
		steps.forEach((delay, index) => within(delay, Math.min(2000 * 1.5 ** index, 30_000)));
	});
});

describe('wait', () => {
	it('ends early when its signal aborts', async () => {
		vi.useFakeTimers();
		try {
			const controller = new AbortController();
			const done = vi.fn();
			void wait(10_000, controller.signal).then(done);
			await vi.advanceTimersByTimeAsync(100);
			expect(done).not.toHaveBeenCalled();
			controller.abort();
			await vi.advanceTimersByTimeAsync(0);
			expect(done).toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('retryTransient', () => {
	const quick: Backoff = { base: 1, factor: 1, max: 1, times: 3 };

	it('sends again while the result is transient and returns the first lasting one', async () => {
		let attempts = 0;
		const result = await retryTransient(
			async () => {
				attempts += 1;
				return attempts < 3 ? { ok: false, transient: true } : { ok: true, transient: false };
			},
			(response) => response.transient,
			quick
		);
		expect(result).toEqual({ ok: true, transient: false });
		expect(attempts).toBe(3);
	});

	it('gives up after the backoff and returns the last transient result', async () => {
		let attempts = 0;
		const result = await retryTransient(
			async () => ({ attempt: ++attempts }),
			() => true,
			quick
		);
		expect(attempts).toBe(4);
		expect(result).toEqual({ attempt: 4 });
	});

	it('returns a lasting failure at once', async () => {
		let attempts = 0;
		const result = await retryTransient(
			async () => ({ attempt: ++attempts, status: 507 }),
			(response) => response.status >= 502 && response.status <= 504,
			quick
		);
		expect(result).toEqual({ attempt: 1, status: 507 });
	});

	it('ends the wait before a retry as soon as its signal aborts', async () => {
		vi.useFakeTimers();
		try {
			const stop = new AbortController();
			let attempts = 0;
			const pending = retryTransient(
				async () => ({ attempt: ++attempts }),
				() => !stop.signal.aborted,
				{ base: 60_000, factor: 1, max: 60_000, times: 3 },
				stop.signal
			);
			await vi.advanceTimersByTimeAsync(0);
			expect(attempts).toBe(1);

			stop.abort();

			// No time passes: the minute before the retry is not waited out.
			expect(await pending).toEqual({ attempt: 2 });
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('untilAborted', () => {
	it('settles as the work does while the signal holds', async () => {
		const signal = new AbortController().signal;
		expect(await untilAborted(Promise.resolve('done'), signal)).toBe('done');
		await expect(untilAborted(Promise.reject(new Error('failed')), signal)).rejects.toThrow(
			'failed'
		);
		expect(await untilAborted(Promise.resolve('no signal'))).toBe('no signal');
	});

	it('stops waiting with the reason given once the signal aborts', async () => {
		const stop = new AbortController();
		const waiting = untilAborted(new Promise(() => undefined), stop.signal);
		stop.abort(new Error('gave up'));
		await expect(waiting).rejects.toThrow('gave up');
		await expect(untilAborted(Promise.resolve('late'), stop.signal)).rejects.toThrow('gave up');
	});
});

describe('withinTime', () => {
	/** A request that only ends when its signal gives it up, with the reason given. */
	const neverAnswered = (signal: AbortSignal) =>
		new Promise<string>((_resolve, reject) =>
			signal.addEventListener('abort', () => reject(signal.reason), { once: true })
		);

	it('gives up a request the relay has not answered in time', async () => {
		vi.useFakeTimers();
		try {
			const waiting = withinTime(1_000, null, neverAnswered);
			const outcome = waiting.catch((error: Error) => error.message);
			await vi.advanceTimersByTimeAsync(999);
			await vi.advanceTimersByTimeAsync(1);
			expect(await outcome).toBe('Sync timed out');
		} finally {
			vi.useRealTimers();
		}
	});

	it('gives it up at once, with the reason given, when whoever waits stops waiting', async () => {
		const stop = new AbortController();
		const waiting = withinTime(60_000, stop.signal, neverAnswered);
		stop.abort(new Error('gave up'));
		await expect(waiting).rejects.toThrow('gave up');
	});

	it('leaves no timer behind once the request is answered', async () => {
		vi.useFakeTimers();
		try {
			expect(await withinTime(1_000, null, async () => 'answered')).toBe('answered');
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});
