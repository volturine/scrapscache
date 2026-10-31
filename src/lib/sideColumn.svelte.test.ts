import { afterEach, describe, expect, it } from 'vitest';
import { publishSideColumn, sideColumn, sideColumnOf } from './sideColumn.svelte.js';

const folded = { top: 0, right: 84, bottom: 34, left: 0 };

describe('sideColumnOf', () => {
	it('is the folded Duo: a portrait phone window with a deep inset at one side', () => {
		expect(sideColumnOf(folded)).toBe('right');
		expect(sideColumnOf({ ...folded, right: 0, left: 84 })).toBe('left');
	});

	it('is the same column in landscape, and when a top inset is also reported', () => {
		expect(sideColumnOf({ top: 0, right: 84, bottom: 21, left: 0 })).toBe('right');
		expect(sideColumnOf({ top: 59, right: 84, bottom: 21, left: 0 })).toBe('right');
		expect(sideColumnOf({ top: 24, right: 0, bottom: 21, left: 84 })).toBe('left');
	});

	it('is not a landscape notch, a bar on top, or a shallow corner', () => {
		expect(sideColumnOf({ top: 0, right: 59, bottom: 21, left: 59 })).toBeNull();
		expect(sideColumnOf({ top: 59, right: 0, bottom: 34, left: 0 })).toBeNull();
		expect(sideColumnOf({ top: 0, right: 84, bottom: 21, left: 84 })).toBeNull();
		expect(sideColumnOf({ ...folded, right: 20 })).toBeNull();
	});
});

describe('publishSideColumn', () => {
	afterEach(() => publishSideColumn(null));

	it('marks the document and the store, and clears both', () => {
		publishSideColumn('right');
		expect(document.documentElement.dataset.sideColumn).toBe('right');
		expect(sideColumn.side).toBe('right');
		publishSideColumn(null);
		expect(document.documentElement.dataset.sideColumn).toBeUndefined();
		expect(sideColumn.side).toBeNull();
	});
});
