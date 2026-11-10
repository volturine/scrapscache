import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteImage } from '#lib/types.js';
import { createSyncIdentity } from '#lib/syncPairing.js';
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

	it('does not record actions the same control reverses', () => {
		const created = notesStore.createNote({ title: 'Note' });
		notesStore.toggleArchive(created.id);
		actionUndo.clear();

		notesStore.togglePin(created.id);
		notesStore.setColor(created.id, 'red');
		notesStore.toggleSecret(created.id);
		notesStore.setReminder(created.id, 5_000);
		notesStore.toggleArchive(created.id);

		expect(note(created.id)).toMatchObject({ pinned: false, color: 'red', archived: false });
		expect(actionUndo.past).toHaveLength(0);
		expect(actionUndo.bar).toBeNull();
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

	it('puts back a removed attachment and does not record adding one', async () => {
		const created = notesStore.createNote({ title: 'Photo' });
		notesStore.updateNote(created.id, { images: [photo('keep'), photo('shot')] });
		expect(actionUndo.past).toHaveLength(0);

		await notesStore.removeAttachment(created.id, photo('shot'));

		expect(actionUndo.bar).toBe('Attachment removed');
		expect(note(created.id)?.images?.map((image) => image.id)).toEqual(['keep']);

		actionUndo.undo();
		expect(
			note(created.id)
				?.images?.map((image) => image.id)
				.sort()
		).toEqual(['keep', 'shot']);
		expect(note(created.id)?.imageTombstones?.shot).toBeUndefined();

		actionUndo.redo();
		expect(note(created.id)?.images?.map((image) => image.id)).toEqual(['keep']);
	});

	it('removes and restores a photo marker at its original place through redo', async () => {
		const body = 'Before\n![shot.jpg](photo:shot)\nAfter';
		const created = notesStore.createNote({ title: 'Photo', body });
		notesStore.updateNote(created.id, { images: [photo('shot')] });

		await notesStore.removeAttachment(created.id, photo('shot'));

		expect(note(created.id)?.body).toBe('Before\nAfter');
		actionUndo.undo();
		expect(note(created.id)?.body).toBe(body);
		actionUndo.redo();
		expect(note(created.id)?.body).toBe('Before\nAfter');
	});

	it('preserves body edits made after removal and appends the marker on undo', async () => {
		const created = notesStore.createNote({
			title: 'Photo',
			body: 'Before\n![shot.jpg](photo:shot)\nAfter'
		});
		notesStore.updateNote(created.id, { images: [photo('shot')] });

		await notesStore.removeAttachment(created.id, photo('shot'));
		notesStore.updateNote(created.id, { body: 'Updated first line\nUpdated last line' });

		actionUndo.undo();
		expect(note(created.id)?.body).toBe(
			'Updated first line\nUpdated last line\n![shot.jpg](photo:shot)'
		);
		actionUndo.redo();
		expect(note(created.id)?.body).toBe('Updated first line\nUpdated last line');
	});

	it('hydrates attachment bytes before removal so Undo remains available', async () => {
		const placeholder = { ...photo('shot'), dataUrl: '' };
		const created = notesStore.createNote({ title: 'Photo' });
		notesStore.updateNote(created.id, { images: [placeholder] });
		const hydrate = vi.spyOn(notesStore, 'ensureNoteAttachments').mockImplementation(async (id) => {
			const index = notesStore.notes.findIndex((item) => item.id === id);
			const current = notesStore.notes[index];
			if (current) notesStore.notes[index] = { ...current, images: [photo('shot')] };
		});

		await notesStore.removeAttachment(created.id, placeholder);

		expect(hydrate).toHaveBeenCalledWith(created.id);
		actionUndo.undo();
		expect(note(created.id)?.images?.[0]).toMatchObject({
			id: 'shot',
			dataUrl: photo('shot').dataUrl
		});
	});

	it('keeps the attachment when hydration cannot recover its bytes', async () => {
		const placeholder = { ...photo('shot'), dataUrl: '' };
		const created = notesStore.createNote({ title: 'Photo' });
		notesStore.updateNote(created.id, { images: [placeholder] });
		vi.spyOn(notesStore, 'ensureNoteAttachments').mockResolvedValue();

		await expect(notesStore.removeAttachment(created.id, placeholder)).rejects.toThrow(
			/it was not removed/i
		);
		expect(note(created.id)?.images?.map((image) => image.id)).toEqual(['shot']);
		expect(actionUndo.past).toHaveLength(0);
	});

	it('keeps tags added after a label was deleted', () => {
		const work = notesStore.createLabel('Work');
		const home = notesStore.createLabel('Home');
		const created = notesStore.createNote({ title: 'Tagged', labels: [work!.id] });
		notesStore.removeLabel(work!.id);
		notesStore.toggleLabel(created.id, home!.id);

		actionUndo.undo();

		const revived = notesStore.labels.find((item) => item.name === 'Work');
		expect(note(created.id)?.labels.sort()).toEqual([home!.id, revived!.id].sort());
		expect(note(created.id)?.trashed).toBe(false);
	});
});
