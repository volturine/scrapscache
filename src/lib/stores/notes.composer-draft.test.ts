import { afterEach, describe, expect, it } from 'vitest';
import type { Note } from '#lib/types.js';
import { composerStore } from './composer.svelte';
import { notesStore } from './notes.svelte';

function note(id: string): Note {
	return {
		id,
		title: id,
		body: '',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: []
	};
}

afterEach(() => {
	composerStore.draftId = null;
	notesStore.notes = [];
});

describe('the composer’s draft', () => {
	it('stays out of the feed until the bar is put away', () => {
		notesStore.notes = [note('draft'), note('kept')];
		composerStore.draftId = 'draft';
		expect(notesStore.activeNotes.map((n) => n.id)).toEqual(['kept']);
		composerStore.draftId = null;
		expect(notesStore.activeNotes.map((n) => n.id)).toEqual(['draft', 'kept']);
	});

	it('is opened by whoever has the bar, and says so when nobody has', () => {
		expect(composerStore.open()).toBe(false);
		const seeds: unknown[] = [];
		const detach = composerStore.attach((seed) => seeds.push(seed));
		expect(composerStore.open({ body: 'pasted' })).toBe(true);
		expect(seeds).toEqual([{ body: 'pasted' }]);
		detach();
		expect(composerStore.open()).toBe(false);
	});
});
