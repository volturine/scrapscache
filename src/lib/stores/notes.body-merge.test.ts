import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllNotes, getAllNotesMetadata, putNote } from '#lib/db/idb.js';
import { applyNoteEdit, BodyAuthor, type EditContext } from '#lib/model/index.js';
import { noteForLocalStorage, NOTES_MIRROR_KEY } from '#lib/noteStorage.js';
import type { Note } from '#lib/types.js';
import { notesStore } from './notes.svelte.js';
import { syncStore } from './sync.svelte.js';
import { seedTestKeyring, TEST_WORKSPACE } from '../../tests/workspace';

const MIRROR = `${NOTES_MIRROR_KEY}:${TEST_WORKSPACE}`;

function note(): Note {
	return {
		id: 'body-merge',
		title: 'Original title',
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
		images: []
	};
}

function context(at: number, writer: string): EditContext {
	return { now: () => at, writer, author: new BodyAuthor() };
}

function withoutBodyDoc(source: Note): Note {
	const { bodyDoc: _bodyDoc, ...plain } = source;
	return plain;
}

function writePlainMirror(source: Note) {
	localStorage.setItem(MIRROR, JSON.stringify([noteForLocalStorage(withoutBodyDoc(source))]));
}

beforeEach(async () => {
	localStorage.clear();
	seedTestKeyring();
	syncStore.activateLocalWorkspace(TEST_WORKSPACE);
	await clearAllNotes(TEST_WORKSPACE);
	notesStore.notes = [];
	notesStore.labels = [];
	notesStore.loaded = false;
	notesStore.deletedNoteIds = {};
	notesStore.deletedLabelIds = {};
});

afterEach(() => {
	vi.restoreAllMocks();
	notesStore.notes = [];
	notesStore.labels = [];
	notesStore.loaded = false;
});

describe('booting with a plain mirror of a documented body', () => {
	it('keeps one copy and preserves the document across repeated mirror replay', async () => {
		const documented = applyNoteEdit(note(), { body: 'alpha\nbeta' }, context(10, 'device'));
		const mirror = applyNoteEdit(
			withoutBodyDoc(documented),
			{ title: 'Newer mirror title' },
			context(20, 'mirror')
		);
		await putNote(TEST_WORKSPACE, documented);
		writePlainMirror(mirror);

		await notesStore.init();

		expect(notesStore.notes).toHaveLength(1);
		const first = notesStore.notes[0];
		expect(first).toMatchObject({
			title: 'Newer mirror title',
			body: 'alpha\nbeta',
			bodyDoc: documented.bodyDoc
		});
		expect(await getAllNotesMetadata(TEST_WORKSPACE)).toEqual([first]);

		// Replay the old mirror again to model a boot with the same pre-document snapshot.
		writePlainMirror(mirror);
		notesStore.notes = [];
		notesStore.loaded = false;
		await notesStore.init();

		expect(notesStore.notes).toHaveLength(1);
		expect(notesStore.notes[0].body).toBe(first.body);
		expect(notesStore.notes[0].bodyDoc).toBe(first.bodyDoc);
		expect(notesStore.notes[0].title).toBe('Newer mirror title');
		expect((await getAllNotesMetadata(TEST_WORKSPACE))[0]).toMatchObject({
			body: first.body,
			bodyDoc: first.bodyDoc,
			title: 'Newer mirror title'
		});
	});

	it('keeps a newer title from a stale plain mirror without replacing the body document', async () => {
		const older = applyNoteEdit(note(), { body: 'alpha\nbeta' }, context(5, 'device'));
		const documented = applyNoteEdit(older, { body: 'alpha\nbeta\ngamma' }, context(10, 'device'));
		const staleMirror = applyNoteEdit(
			withoutBodyDoc(older),
			{ title: 'Title edited after the stale body snapshot' },
			context(20, 'mirror')
		);
		await putNote(TEST_WORKSPACE, documented);
		writePlainMirror(staleMirror);

		await notesStore.init();

		expect(notesStore.notes).toHaveLength(1);
		const first = notesStore.notes[0];
		expect(first).toMatchObject({
			title: 'Title edited after the stale body snapshot',
			body: 'alpha\nbeta\ngamma',
			bodyDoc: documented.bodyDoc
		});
		expect((await getAllNotesMetadata(TEST_WORKSPACE))[0]).toMatchObject({
			body: first.body,
			bodyDoc: first.bodyDoc,
			title: first.title
		});

		// A repeated boot with the stale plain snapshot cannot append its text again.
		writePlainMirror(staleMirror);
		notesStore.notes = [];
		notesStore.loaded = false;
		await notesStore.init();

		expect(notesStore.notes).toHaveLength(1);
		expect(notesStore.notes[0].body).toBe('alpha\nbeta\ngamma');
		expect(notesStore.notes[0].bodyDoc).toBe(documented.bodyDoc);
		expect(notesStore.notes[0].title).toBe(first.title);
	});
});
