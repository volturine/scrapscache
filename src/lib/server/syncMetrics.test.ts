import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncTimings } from './syncMetrics';

afterEach(() => vi.useRealTimers());

describe('createSyncTimings', () => {
	it('adds up every measured stretch of a phase and its call counts', () => {
		vi.useFakeTimers({ now: 1_000 });
		const timings = createSyncTimings();
		timings.start('r2_get');
		vi.advanceTimersByTime(30);
		timings.stop('r2_get');
		timings.start('r2_get');
		vi.advanceTimersByTime(12);
		timings.stop('r2_get');
		timings.count('r2_get', 2);
		timings.count('r2_get', 1);

		expect(timings.timings()).toEqual({
			'sync_ms phase:r2_get': 42,
			'sync_calls phase:r2_get': 3
		});
	});

	it('records nothing for a stop without a start, or a second stop', () => {
		vi.useFakeTimers({ now: 1_000 });
		const timings = createSyncTimings();
		timings.stop('commit');
		timings.start('tail');
		vi.advanceTimersByTime(5);
		timings.stop('tail');
		vi.advanceTimersByTime(100);
		timings.stop('tail');

		expect(timings.timings()).toEqual({ 'sync_ms phase:tail': 5 });
	});
});
