import { afterEach, describe, expect, it } from 'vitest';
import type { Note } from '#lib/types.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { noMatchCopy, placesWithMatches, shownQuery } from './searchElsewhere';

function note(id: string, partial: Partial<Note> = {}): Note {
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
		labels: [],
		...partial
	};
}

afterEach(() => {
	notesStore.notes = [];
});

describe('shownQuery', () => {
	it('keeps a short query whole', () => {
		expect(shownQuery('  retro  ')).toBe('retro');
		expect(shownQuery('x'.repeat(40))).toBe('x'.repeat(40));
	});

	it('cuts a long query at 39 characters without splitting an emoji', () => {
		expect(shownQuery('x'.repeat(41))).toBe(`${'x'.repeat(39)}…`);
		expect(shownQuery(`${'x'.repeat(38)}👋👋👋`)).toBe(`${'x'.repeat(38)}👋…`);
	});
});

describe('placesWithMatches', () => {
	it('lists the other places where the query finds notes', () => {
		notesStore.notes = [
			note('active', { body: 'retro board' }),
			note('archived', { body: 'retro notes', archived: true }),
			note('trashed', { body: 'something else', trashed: true, trashedAt: 1 })
		];

		expect(placesWithMatches('notes', 'retro')).toEqual(['archive']);
		expect(placesWithMatches('trash', 'retro')).toEqual(['notes', 'archive']);
		// A label view searches only some active notes, so the rest of Notes counts.
		expect(placesWithMatches('label', 'retro')).toEqual(['notes', 'archive']);
		expect(placesWithMatches('archive', 'nothing')).toEqual([]);
	});
});

describe('noMatchCopy', () => {
	it('names the query, the view’s scope and where to look', () => {
		expect(noMatchCopy('notes', 'retro', ['archive', 'trash'])).toEqual({
			title: 'No notes match “retro”',
			description: 'Archived and deleted notes are not searched here.',
			announcement: 'No notes match “retro”. Look in Archive or Trash.'
		});
		expect(noMatchCopy('archive', 'retro', ['notes']).announcement).toBe(
			'No notes match “retro”. Look in Notes.'
		);
	});

	it('says when nothing else matches either', () => {
		expect(noMatchCopy('notes', 'retro', []).description).toBe(
			'Archive and Trash have no matches either.'
		);
		expect(noMatchCopy('label', 'retro', []).description).toBe(
			'Notes, Archive and Trash have no matches either.'
		);
		expect(noMatchCopy('trash', 'retro', []).announcement).toBe(
			'No notes match “retro”. Notes and Archive have no matches either.'
		);
	});
});
