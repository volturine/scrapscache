import { describe, expect, it } from 'vitest';
import { dropIndexAt, edgeSpeed, pageDirection, pagedScrollLeft } from './kanbanDrag.svelte';

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

describe('edgeSpeed', () => {
	// A phone screen's worth of feed.
	const view = [0, 780] as const;
	/** Peak speed the module scrolls at, in pixels per frame. */
	const full = 12;

	it('holds still while the finger is away from both edges', () => {
		expect(edgeSpeed(390, ...view)).toBe(0);
		expect(edgeSpeed(80, ...view)).toBe(0);
		expect(edgeSpeed(700, ...view)).toBe(0);
	});

	it('runs the list up as the finger nears the top', () => {
		expect(edgeSpeed(40, ...view)).toBeLessThan(0);
		expect(edgeSpeed(0, ...view)).toBe(-full);
		expect(edgeSpeed(-50, ...view)).toBe(-full);
	});

	it('runs the list down as the finger nears the bottom', () => {
		expect(edgeSpeed(740, ...view)).toBeGreaterThan(0);
		expect(edgeSpeed(780, ...view)).toBe(full);
		expect(edgeSpeed(900, ...view)).toBe(full);
	});

	it('shrinks the band rather than filling a short scroller with it', () => {
		// 120px tall: a 64px band top and bottom would leave nowhere neutral.
		expect(edgeSpeed(60, 0, 120)).toBe(0);
	});
});

describe('pageDirection', () => {
	// A phone board: the card sits inset in a column that fills the screen.
	const view = [0, 390] as const;

	it('stays put while the card is inside the board', () => {
		expect(pageDirection(16, 304, ...view)).toBe(0);
		expect(pageDirection(0, 390, ...view)).toBe(0);
	});

	it('pages towards the side the card is shoved past', () => {
		expect(pageDirection(120, 408, ...view)).toBe(1);
		expect(pageDirection(-120, 168, ...view)).toBe(-1);
	});

	it('ignores a sliver of overhang', () => {
		expect(pageDirection(110, 398, ...view)).toBe(0);
	});

	it('follows the side it hangs over further when wider than the board', () => {
		expect(pageDirection(-20, 480, ...view)).toBe(1);
		expect(pageDirection(-120, 400, ...view)).toBe(-1);
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
