import { afterEach, describe, expect, it } from 'vitest';
import type { Note } from '#lib/types.js';
import { actionUndo } from './actionUndo.svelte';
import { notesStore } from './notes.svelte';

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

const byId = (id: string) => notesStore.notes.find((item) => item.id === id)!;

afterEach(() => {
	notesStore.notes = [];
	notesStore.labels = [];
	actionUndo.clear();
});

describe('actions on many notes', () => {
	it('archives them under one undo step, which brings every one back as it was', () => {
		notesStore.notes = [note('a', { pinned: true }), note('b'), note('c', { archived: true })];

		notesStore.archiveNotes(['a', 'b', 'c']);

		expect(byId('a')).toMatchObject({ archived: true, pinned: false });
		expect(byId('b').archived).toBe(true);
		expect(actionUndo.bar).toBe('3 notes archived');
		expect(actionUndo.past).toHaveLength(1);
		// The already-archived note was left alone, so the step does not claim it.
		expect(actionUndo.past[0].noteIds).toEqual(['a', 'b']);

		actionUndo.undo();
		expect(byId('a')).toMatchObject({ archived: false, pinned: true });
		expect(byId('b').archived).toBe(false);
		expect(byId('c').archived).toBe(true);

		actionUndo.redo();
		expect(byId('a').archived).toBe(true);
	});

	it('moves them to the trash and restores them, each as one step', () => {
		notesStore.notes = [note('a', { pinned: true }), note('b')];
		notesStore.trashNotes(['a', 'b']);
		expect(byId('a')).toMatchObject({ trashed: true, pinned: false });
		expect(byId('a').trashedAt).not.toBeNull();
		expect(actionUndo.bar).toBe('2 notes moved to trash');

		notesStore.restoreNotes(['a', 'b']);
		expect(byId('a')).toMatchObject({ trashed: false, trashedAt: null, archived: false });
		expect(actionUndo.bar).toBe('2 notes restored');
		actionUndo.undo();
		expect(byId('b').trashed).toBe(true);
	});

	it('records nothing when there is nothing to do', () => {
		notesStore.notes = [note('a', { archived: true })];
		notesStore.archiveNotes(['a', 'missing']);
		expect(actionUndo.past).toHaveLength(0);
		expect(actionUndo.bar).toBeNull();
	});

	it('pins, colours, reminds and labels every note, with no undo step', () => {
		notesStore.labels = [{ id: 'l', name: 'Work', createdAt: 1, updatedAt: 1 }];
		notesStore.notes = [note('a', { labels: ['l'] }), note('b')];

		notesStore.pinNotes(['a', 'b'], true);
		notesStore.setColorMany(['a', 'b'], 'blue');
		notesStore.setReminderMany(['a', 'b'], 1_000);
		notesStore.setLabelMany(['a', 'b'], 'l', true);
		for (const id of ['a', 'b']) {
			expect(byId(id)).toMatchObject({
				pinned: true,
				color: 'blue',
				reminder: 1_000,
				labels: ['l']
			});
		}

		notesStore.setLabelMany(['a', 'b'], 'l', false);
		expect(byId('a').labels).toEqual([]);
		expect(actionUndo.past).toHaveLength(0);
	});
});
