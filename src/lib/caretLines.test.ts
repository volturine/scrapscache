import { describe, expect, it } from 'vitest';
import { offsetNearestX, sameVisualLine, type CaretStop } from './caretLines.js';

function stop(offset: number, x: number, top: number, height = 20): CaretStop {
	return { offset, x, top, bottom: top + height };
}

describe('sameVisualLine', () => {
	it('tells a wrapped line from the one before it', () => {
		expect(sameVisualLine(stop(0, 0, 0), stop(1, 10, 0))).toBe(true);
		expect(sameVisualLine(stop(0, 0, 0), stop(9, 0, 20))).toBe(false);
	});

	it('keeps a slightly taller inline box on the same line', () => {
		expect(sameVisualLine(stop(0, 0, 0), stop(1, 10, -3, 26))).toBe(true);
	});
});

describe('offsetNearestX', () => {
	const line = [stop(4, 0, 0), stop(5, 10, 0), stop(6, 20, 0)];

	it('picks the stop drawn closest to the goal', () => {
		expect(offsetNearestX(line, 12)).toBe(5);
		expect(offsetNearestX(line, 400)).toBe(6);
		expect(offsetNearestX(line, -50)).toBe(4);
	});

	it('prefers the earlier stop on a tie', () => {
		expect(offsetNearestX(line, 15)).toBe(5);
	});
});
