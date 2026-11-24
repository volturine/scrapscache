import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Retries } from './syncRetry';

describe('work that is tried again by itself', () => {
	let retries: Retries;
	let ran: string[];

	beforeEach(() => {
		vi.useFakeTimers();
		// The middle of the ±20% variation: every wait is exactly its step.
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		retries = new Retries({ base: 1_000, factor: 2, max: 4_000 });
		ran = [];
	});

	afterEach(() => {
		retries.clear();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('waits longer after each failure in a row, up to the longest step', () => {
		const fail = () => retries.failed('note', () => (ran.push('note'), fail()));
		fail();
		for (const [waited, runs] of [
			[999, 0],
			[1, 1],
			[1_999, 1],
			[1, 2],
			[4_000, 3],
			[4_000, 4]
		]) {
			vi.advanceTimersByTime(waited);
			expect(ran).toHaveLength(runs);
		}
	});

	it('keeps one wait per key, and runs what failed last', () => {
		retries.failed('label', () => ran.push('first'));
		vi.advanceTimersByTime(600);
		retries.failed('label', () => ran.push('second'));
		retries.failed('other', () => ran.push('other'));

		vi.advanceTimersByTime(400);
		expect(ran).toEqual(['second']);
		vi.advanceTimersByTime(600);
		expect(ran).toEqual(['second', 'other']);
	});

	it('starts over once the work got through', () => {
		retries.failed('note', () => ran.push('first'));
		vi.advanceTimersByTime(1_000);
		retries.succeeded('note');

		retries.failed('note', () => ran.push('second'));
		vi.advanceTimersByTime(1_000);
		expect(ran).toEqual(['first', 'second']);
	});

	it('drops the wait for work being tried now, and still counts what it failed', () => {
		retries.failed('note', () => ran.push('waited'));
		retries.trying('note');
		vi.advanceTimersByTime(10_000);
		expect(ran).toEqual([]);

		retries.failed('note', () => ran.push('again'));
		vi.advanceTimersByTime(1_999);
		expect(ran).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(ran).toEqual(['again']);
	});

	it('keeps the wait of a later failure when an earlier attempt gets through', () => {
		retries.failed('note', () => ran.push('first'));
		vi.advanceTimersByTime(1_000);
		// The retry is under way; another write of the same note fails meanwhile.
		retries.failed('note', () => ran.push('second'));
		retries.succeeded('note');

		vi.advanceTimersByTime(2_000);
		expect(ran).toEqual(['first', 'second']);
	});

	it('runs nothing once settled or cleared', () => {
		retries.failed('note', () => ran.push('note'));
		retries.failed('label', () => ran.push('label'));
		retries.settled('note');
		retries.clear();
		vi.advanceTimersByTime(60_000);
		expect(ran).toEqual([]);
	});
});
