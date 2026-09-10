import { describe, expect, it } from 'vitest';
import { dropIndexAt } from './kanbanDrag.svelte';

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
