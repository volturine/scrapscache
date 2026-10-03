// Retry timing for talking to the relay. Each delay is an exponential step capped
// at `max`, then varied by ±20%: every device that lost the relay at the same
// moment would otherwise come back at the same moment, the cap included.
import { Duration, Effect, Schedule } from 'effect';

export function cappedBackoff(options: {
	base: Duration.Input;
	factor: number;
	max: Duration.Input;
}): Schedule.Schedule<Duration.Duration> {
	const max = Duration.fromInputUnsafe(options.max);
	return Schedule.exponential(options.base, options.factor).pipe(
		Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, max))),
		Schedule.jittered
	);
}

/** A request the relay never answered, or could not serve: about 0.5, 1 and 2 seconds apart. */
export const transientRetry = cappedBackoff({
	base: '500 millis',
	factor: 2,
	max: '5 seconds'
}).pipe(Schedule.upTo({ times: 3 }));

/** Live sync events: from 2 seconds, half again longer each time, at most 30 seconds. */
export const reconnectBackoff = cappedBackoff({
	base: '2 seconds',
	factor: 1.5,
	max: '30 seconds'
});

/**
 * Run `attempt` again for as long as `schedule` allows while its result is
 * `transient`. The last result is returned either way, so a caller sees the same
 * shape of answer whether or not a retry happened.
 */
export function retryTransient<A>(
	attempt: () => Promise<A>,
	transient: (result: A) => boolean,
	schedule: Schedule.Schedule<unknown> = transientRetry
): Promise<A> {
	return Effect.runPromise(
		Effect.promise(attempt).pipe(
			Effect.flatMap((result) =>
				transient(result) ? Effect.fail(result) : Effect.succeed(result)
			),
			Effect.retry(schedule),
			Effect.catch((result) => Effect.succeed(result))
		)
	);
}
