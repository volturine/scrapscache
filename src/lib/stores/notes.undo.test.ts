import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NoteImage } from '$lib/types';
import { createSyncIdentity } from '$lib/syncPairing';
import { actionUndo } from './actionUndo.svelte';
import { notesStore } from './notes.svelte';
import { syncStore } from './sync.svelte';

function photo(id: string): NoteImage {
	return {
		id,
		name: `${id}.jpg`,
		mime: 'image/jpeg',
		dataUrl: 'data:image/jpeg;base64,AA==',
		createdAt: 1
	};
}

describe('note undo', () => {
	beforeEach(() => {
		localStorage.clear();
		actionUndo.clear();
		const account = createSyncIdentity();
		const profile = {
			id: 'profile-undo',
			name: 'Undo profile',
			syncKey: account.syncKey,
			createdAt: 1
		};
		syncStore.profiles = [profile];
		syncStore.activateProfile(profile);
		notesStore.notes = [];
		notesStore.labels = [];
	});

	afterEach(() => {
		const internals = notesStore as unknown as {
			dirty: boolean;
			syncPushTimer: ReturnType<typeof setTimeout> | null;
		};
		if (internals.syncPushTimer) clearTimeout(internals.syncPushTimer);
		internals.syncPushTimer = null;
		internals.dirty = false;
		syncStore.account = null;
		syncStore.profiles = [];
		notesStore.notes = [];
		notesStore.labels = [];
		actionUndo.clear();
	});

	function note(id: string) {
		return notesStore.notes.find((item) => item.id === id);
	}

	it('restores archive and the pin it cleared', () => {
		const created = notesStore.createNote({ title: 'Pinned', pinned: true });

		notesStore.toggleArchive(created.id);

		expect(note(created.id)).toMatchObject({ archived: true, pinned: false });
		expect(actionUndo.bar).toBe('Note archived');

		actionUndo.undo();
		expect(note(created.id)).toMatchObject({ archived: false, pinned: true });
		expect(actionUndo.bar).toBeNull();

		actionUndo.redo();
		expect(note(created.id)).toMatchObject({ archived: true, pinned: false });
		expect(actionUndo.bar).toBe('Note archived');
	});

	it('restores a pin when a note leaves trash', () => {
		const created = notesStore.createNote({ title: 'Pinned', pinned: true });

		notesStore.trashNote(created.id);

		expect(actionUndo.bar).toBe('Moved to trash');
		expect(note(created.id)?.trashed).toBe(true);

		actionUndo.undo();
		expect(note(created.id)).toMatchObject({ trashed: false, pinned: true, trashedAt: null });
	});

	it('hides the bar for a pin', () => {
		const created = notesStore.createNote({ title: 'Note' });
		notesStore.toggleArchive(created.id);
		notesStore.togglePin(created.id);

		expect(note(created.id)?.pinned).toBe(true);
		expect(actionUndo.bar).toBeNull();
		expect(actionUndo.past).toHaveLength(2);
	});

	it('does not record tagging or creating a label', () => {
		const label = notesStore.createLabel('Work');
		const created = notesStore.createNote({ title: 'Tagged' });
		actionUndo.clear();

		notesStore.toggleLabel(created.id, label!.id);
		notesStore.createLabel('Home');

		expect(actionUndo.past).toHaveLength(0);
		expect(note(created.id)?.labels).toEqual([label!.id]);
	});

	it('brings back a deleted label and the notes it trashed', () => {
		const label = notesStore.createLabel('Work');
		const created = notesStore.createNote({
			title: 'Tagged',
			labels: [label!.id],
			pinned: true
		});

		notesStore.removeLabel(label!.id, { deleteNotes: true });

		expect(actionUndo.bar).toBe('Label deleted');
		expect(notesStore.labels.some((item) => item.name === 'Work')).toBe(false);
		expect(note(created.id)?.trashed).toBe(true);

		actionUndo.undo();

		const revived = notesStore.labels.find((item) => item.name === 'Work');
		expect(revived?.id).toBeTruthy();
		expect(note(created.id)).toMatchObject({
			trashed: false,
			pinned: true,
			labels: [revived!.id]
		});
	});

	it('drops trash undo when the note is deleted forever', async () => {
		const created = notesStore.createNote({ title: 'Gone' });
		notesStore.trashNote(created.id);

		await notesStore.deleteNoteForever(created.id);

		expect(notesStore.notes).toEqual([]);
		expect(actionUndo.past).toHaveLength(0);
		expect(actionUndo.bar).toBeNull();
	});

	it('removes a photo that was just added', () => {
		const created = notesStore.createNote({ title: 'Photo' });

		notesStore.updateNote(created.id, { images: [photo('shot')] });

		expect(actionUndo.bar).toBeNull();
		expect(note(created.id)?.images?.map((image) => image.id)).toEqual(['shot']);

		actionUndo.undo();
		expect(note(created.id)?.images ?? []).toEqual([]);
	});
});
