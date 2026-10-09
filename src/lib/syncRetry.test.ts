import { describe, expect, it, vi } from 'vitest';
import {
	backoffDelay,
	reconnectBackoff,
	retryTransient,
	transientRetry,
	wait,
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
});
