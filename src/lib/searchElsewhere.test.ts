import { afterEach, describe, expect, it } from 'vitest';
import type { Note } from '#lib/types.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { matchesElsewhere, noMatchCopy, shownQuery } from './searchElsewhere';

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

describe('matchesElsewhere', () => {
	it('counts what the query finds in each other place', () => {
		notesStore.notes = [
			note('active', { body: 'retro board' }),
			note('archived', { body: 'retro notes', archived: true }),
			note('archived-2', { body: 'retro again', archived: true }),
			note('trashed', { body: 'something else', trashed: true, trashedAt: 1 })
		];

		expect(matchesElsewhere('notes', 'retro')).toEqual([
			{ place: 'archive', count: 2 },
			{ place: 'trash', count: 0 }
		]);
		// A label view searches only some active notes, so the rest of Notes counts.
		expect(matchesElsewhere('label', 'retro')).toEqual([
			{ place: 'notes', count: 1 },
			{ place: 'archive', count: 2 },
			{ place: 'trash', count: 0 }
		]);
	});

	it('applies the chips to the other places too', () => {
		notesStore.notes = [
			note('archived', { body: 'retro', archived: true, color: 'blue' }),
			note('archived-2', { body: 'retro', archived: true, color: 'red' })
		];

		expect(matchesElsewhere('notes', 'retro', { label: null, color: 'blue', type: null })).toEqual([
			{ place: 'archive', count: 1 },
			{ place: 'trash', count: 0 }
		]);
	});
});

describe('noMatchCopy', () => {
	it('names the query, where it looked, what the other places hold, and where to look', () => {
		expect(
			noMatchCopy('notes', 'retro', [
				{ place: 'archive', count: 1 },
				{ place: 'trash', count: 0 }
			])
		).toEqual({
			title: 'No notes match “retro”',
			description: 'Searched Notes. There is 1 match in Archive and none in Trash.',
			announcement: 'No notes match “retro”. Look in Archive.'
		});
		// The found places come first, and the count word goes on the first of them.
		expect(
			noMatchCopy('archive', 'retro', [
				{ place: 'notes', count: 0 },
				{ place: 'trash', count: 3 }
			])
		).toEqual({
			title: 'No notes match “retro”',
			description: 'Searched Archive. There are 3 matches in Trash and none in Notes.',
			announcement: 'No notes match “retro”. Look in Trash.'
		});
		expect(
			noMatchCopy('label', 'retro', [
				{ place: 'notes', count: 1 },
				{ place: 'archive', count: 2 },
				{ place: 'trash', count: 0 }
			]).description
		).toBe(
			'Searched only notes with this label. There is 1 match in Notes, 2 in Archive and none in Trash.'
		);
	});

	it('says when nothing else matches either', () => {
		const none = (places: ('notes' | 'archive' | 'trash')[]) =>
			places.map((place) => ({ place, count: 0 }));
		expect(noMatchCopy('notes', 'retro', none(['archive', 'trash'])).description).toBe(
			'Searched Notes. Archive and Trash have no matches either.'
		);
		expect(noMatchCopy('trash', 'retro', none(['notes', 'archive'])).announcement).toBe(
			'No notes match “retro”. Notes and Archive have no matches either.'
		);
	});

	it('blames the chips when some are set', () => {
		const copy = noMatchCopy('notes', 'retro', [{ place: 'archive', count: 0 }], 2);
		expect(copy.title).toBe('No notes match “retro” with these filters');
		expect(copy.announcement).toBe(
			'No notes match “retro” with these filters. Clear the filters to search everything.'
		);
	});
});
