import { afterEach, describe, expect, it } from 'vitest';
import type { Note } from '#lib/types.js';
import { notesStore } from './notes.svelte';

function note(partial: Partial<Note>): Note {
	return {
		id: 'note',
		title: '',
		body: '',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		...partial
	};
}

afterEach(() => {
	notesStore.labels = [];
});

describe('notesStore.search', () => {
	it('matches a title, a body line, a checklist item or a label name, in any case', () => {
		notesStore.labels = [{ id: 'work', name: 'Work', createdAt: 1, updatedAt: 1 }];
		const pool = [
			note({ id: 'title', title: 'Quarterly Retro' }),
			note({ id: 'body', body: 'Plan the retro agenda' }),
			note({ id: 'checklist', body: '[ ] milk\n[x] RETRO snacks' }),
			note({ id: 'label', title: 'Untitled', labels: ['work'] }),
			note({ id: 'neither', title: 'Groceries', body: 'eggs' })
		];

		expect(notesStore.search('retro', pool).map((found) => found.id)).toEqual([
			'title',
			'body',
			'checklist'
		]);
		expect(notesStore.search('WORK', pool).map((found) => found.id)).toEqual(['label']);
	});

	it('keeps the whole pool for a blank query', () => {
		const pool = [note({ id: 'a' }), note({ id: 'b' })];

		expect(notesStore.search('   ', pool)).toBe(pool);
	});
});
