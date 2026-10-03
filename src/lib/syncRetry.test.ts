import { describe, expect, it } from 'vitest';
import { Duration, Effect, Schedule } from 'effect';
import { cappedBackoff, reconnectBackoff, retryTransient, transientRetry } from './syncRetry';

/** The delays a schedule asks for, in milliseconds, until it ends or `limit` is reached. */
function delays(schedule: Schedule.Schedule<unknown>, limit = 12): number[] {
	return Effect.runSync(
		Effect.gen(function* () {
			const step = yield* Schedule.toStep(schedule);
			const out: number[] = [];
			for (let i = 0; i < limit; i += 1) {
				const next = yield* step(Date.now(), undefined).pipe(Effect.option);
				if (next._tag === 'None') break;
				out.push(Duration.toMillis(next.value[1]));
			}
			return out;
		})
	);
}

function within(actual: number, expected: number): void {
	expect(actual).toBeGreaterThanOrEqual(expected * 0.8 - 1);
	expect(actual).toBeLessThanOrEqual(expected * 1.2 + 1);
}

describe('relay retry timing', () => {
	it('grows exponentially up to the cap and varies every delay, the capped ones too', () => {
		const steps = delays(cappedBackoff({ base: '100 millis', factor: 2, max: '1 second' }), 8);
		expect(steps).toHaveLength(8);
		steps.forEach((delay, index) => within(delay, Math.min(100 * 2 ** index, 1000)));
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

describe('retryTransient', () => {
	const quick = cappedBackoff({ base: '1 millis', factor: 1, max: '1 millis' }).pipe(
		Schedule.upTo({ times: 3 })
	);

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

	it('gives up after the schedule and returns the last transient result', async () => {
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
