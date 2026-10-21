import { afterEach, describe, expect, it } from 'vitest';
import { selectionStore } from './selection.svelte';
import { uiStore } from './ui.svelte';

afterEach(() => {
	selectionStore.clear();
	uiStore.setView('notes');
});

describe('selectionStore', () => {
	it('toggles notes in and out, in the order they were picked', () => {
		expect(selectionStore.active).toBe(false);
		selectionStore.toggle('b');
		selectionStore.toggle('a');
		expect(selectionStore.ids).toEqual(['b', 'a']);
		expect(selectionStore.count).toBe(2);
		expect(selectionStore.has('a')).toBe(true);

		selectionStore.toggle('b');
		expect(selectionStore.ids).toEqual(['a']);
		selectionStore.clear();
		expect(selectionStore.active).toBe(false);
	});

	it('lets go when the view changes', () => {
		selectionStore.toggle('a');
		uiStore.setView('archive');
		expect(selectionStore.active).toBe(false);
	});
});
