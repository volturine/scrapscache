import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_CLOCK_OFFSET_MS, SyncClock } from './clock';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('SyncClock', () => {
	it('stamps on the relay clock as of halfway through the round trip', () => {
		const clock = new SyncClock();
		// This device runs two minutes fast.
		expect(clock.observe(1_000_000, 1_120_000, 1_120_200)).toBe(true);
		vi.spyOn(Date, 'now').mockReturnValue(1_130_000);
		expect(clock.now()).toBe(1_009_900);
	});

	it('ignores answers too slow or malformed to place in time', () => {
		const clock = new SyncClock();
		expect(clock.observe(1_000, 0, 60_000)).toBe(false);
		expect(clock.observe('soon', 0, 10)).toBe(false);
		expect(clock.observe(1_000, 10, 0)).toBe(false);
		expect(clock.offset).toBe(0);
	});
});

describe('SyncClock bounds', () => {
	it('moves the clock at most a day in either direction', () => {
		const clock = new SyncClock();
		const tenDays = 10 * 24 * 60 * 60_000;
		expect(clock.observe(1_000_000 + tenDays, 1_000_000, 1_000_000)).toBe(true);
		expect(clock.offset).toBe(MAX_CLOCK_OFFSET_MS);
		expect(clock.observe(1_000_000 - tenDays, 1_000_000, 1_000_000)).toBe(true);
		expect(clock.offset).toBe(-MAX_CLOCK_OFFSET_MS);
		expect(clock.observe(1_000_000 + 60_000, 1_000_000, 1_000_000)).toBe(true);
		expect(clock.offset).toBe(60_000);
	});
});
