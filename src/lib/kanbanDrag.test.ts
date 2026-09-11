import { describe, expect, it } from 'vitest';
import { dropIndexAt, overhangSpeed, pagedScrollLeft } from './kanbanDrag.svelte';

// Three 100px cards, 12px apart, with no drop slot opened yet.
const tops = [0, 112, 224];
const heights = [100, 100, 100];

describe('dropIndexAt', () => {
	it('lands above a card while the pointer is over its top half', () => {
		expect(dropIndexAt(10, tops, heights, -1, 0)).toBe(0);
		expect(dropIndexAt(49, tops, heights, -1, 0)).toBe(0);
	});

	it('lands below a card once the pointer passes its middle', () => {
		expect(dropIndexAt(51, tops, heights, -1, 0)).toBe(1);
		expect(dropIndexAt(300, tops, heights, -1, 0)).toBe(3);
	});

	it('reads an empty column as the only slot there is', () => {
		expect(dropIndexAt(40, [], [], -1, 0)).toBe(0);
	});

	it('ignores the gap it already opened, so the preview cannot oscillate', () => {
		// Same pointer, but slot 1 pushed the cards below it down by 112px.
		const shifted = [0, 224, 336];
		expect(dropIndexAt(150, shifted, heights, 1, 112)).toBe(1);
		expect(dropIndexAt(150, tops, heights, -1, 0)).toBe(1);
	});

	it('still advances when the pointer passes a displaced card', () => {
		const shifted = [0, 224, 336];
		// 170 is past the second card's settled middle (162) but not the third's.
		expect(dropIndexAt(170, shifted, heights, 1, 112)).toBe(2);
		expect(dropIndexAt(280, shifted, heights, 1, 112)).toBe(3);
	});
});

describe('overhangSpeed', () => {
	// A phone column: the card nearly fills the scroller, so a finger anywhere
	// on it would sit in an edge band. Only the card's own overhang may scroll.
	const view = [0, 390] as const;
	/** Peak speed the module scrolls at, in pixels per frame. */
	const full = 12;

	it('stays still while the card is inside the scroller', () => {
		expect(overhangSpeed(16, 374, ...view)).toBe(0);
		expect(overhangSpeed(0, 390, ...view)).toBe(0);
	});

	it('pulls towards the start when the card hangs off the start', () => {
		expect(overhangSpeed(-90, 268, ...view)).toBeLessThan(0);
		expect(overhangSpeed(-200, 158, ...view)).toBe(-full);
	});

	it('pushes towards the end when the card hangs off the end', () => {
		expect(overhangSpeed(122, 480, ...view)).toBeGreaterThan(0);
		expect(overhangSpeed(200, 558, ...view)).toBe(full);
	});

	it('creeps rather than stalls on a sliver of overhang', () => {
		expect(overhangSpeed(120, 392, ...view)).toBeCloseTo(full * 0.2);
	});

	it('follows the far side when the card is larger than the scroller', () => {
		expect(overhangSpeed(-10, 480, ...view)).toBeGreaterThan(0);
		expect(overhangSpeed(-100, 400, ...view)).toBeLessThan(0);
	});
});

describe('pagedScrollLeft', () => {
	// A phone board: three page-wide columns, plus a tail past the last one.
	const starts = [0, 324, 648];
	const max = 700;

	it('steps to the next column', () => {
		expect(pagedScrollLeft(0, max, starts, 1)).toBe(324);
		expect(pagedScrollLeft(324, max, starts, 1)).toBe(648);
	});

	it('steps back to the previous column', () => {
		expect(pagedScrollLeft(648, max, starts, -1)).toBe(324);
		expect(pagedScrollLeft(324, max, starts, -1)).toBe(0);
	});

	it('stops at the ends instead of turning a page into nothing', () => {
		expect(pagedScrollLeft(0, max, starts, -1)).toBeNull();
		expect(pagedScrollLeft(max, max, starts, 1)).toBeNull();
	});

	it('runs out to the board tail past the last column', () => {
		expect(pagedScrollLeft(648, max, starts, 1)).toBe(700);
	});

	it('treats a couple of pixels of drift as already at a column', () => {
		expect(pagedScrollLeft(322, max, starts, 1)).toBe(648);
		expect(pagedScrollLeft(326, max, starts, -1)).toBe(0);
	});

	it('never scrolls outside the board', () => {
		expect(pagedScrollLeft(200, 300, [0, 324, 648], 1)).toBe(300);
	});
});
