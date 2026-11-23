import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/imageThumb.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/imageThumb.js')>();
	return { ...actual, makeImageThumbDataUrl: vi.fn(async () => null) };
});

import * as idb from '#lib/db/idb.js';
import { makeImageThumbDataUrl } from '#lib/imageThumb.js';
import type { NoteImage } from '#lib/types.js';
import { notesStore } from './notes.svelte';
import { syncScheduler } from './syncScheduler';
import { TEST_WORKSPACE } from '../../tests/workspace';

function photo(id: string): NoteImage {
	return {
		id,
		name: `${id}.jpg`,
		mime: 'image/jpeg',
		dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
		createdAt: 1
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe('photo bytes across a failed save', () => {
	beforeEach(() => {
		notesStore.notes = [];
		notesStore.labels = [];
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await syncScheduler.reset();
		(notesStore as unknown as { noteRetries: { clear(): void } }).noteRetries.clear();
		notesStore.notes = [];
		notesStore.lastPersistError = null;
	});

	it('keeps a photo in memory until its own save has landed', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const earlierSave = deferred<void>();
		const putNote = vi
			.spyOn(idb, 'saveNote')
			// The text-only save, still queued when the photo is added.
			.mockImplementationOnce(() => earlierSave.promise)
			// The photo's own save: refused, as a full disk refuses it.
			.mockImplementationOnce(() =>
				Promise.reject(new DOMException('Storage full', 'QuotaExceededError'))
			);

		const created = notesStore.createNote({ title: 'Photo' });
		notesStore.updateNote(created.id, { images: [photo('shot')] });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(putNote).toHaveBeenCalledTimes(2);
		expect(notesStore.lastPersistError).toMatch(/Storage full/);

		earlierSave.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));

		const inMemory = notesStore.notes.find((note) => note.id === created.id);
		expect(inMemory?.images?.[0]?.dataUrl).toBe(photo('shot').dataUrl);
	});

	it('releases durable photo bytes when a resident thumbnail can display them', async () => {
		const created = notesStore.createNote({
			title: 'Photo',
			images: [{ ...photo('shot'), thumbUrl: photo('shot').dataUrl }]
		});
		await idb.waitForDeviceWrites();
		await new Promise((resolve) => setTimeout(resolve, 0));

		const inMemory = notesStore.notes.find((note) => note.id === created.id);
		expect(inMemory?.images?.[0]?.dataUrl).toBe('');
		const hydrated = await idb.hydrateNoteAttachments(
			TEST_WORKSPACE,
			inMemory as NonNullable<typeof inMemory>
		);
		expect(hydrated.images?.[0]?.dataUrl).toBe(photo('shot').dataUrl);
	});

	it('lets go of its hold on the photo saves when the note left the list before its save landed', async () => {
		const letGo = vi.fn();
		vi.spyOn(idb, 'holdAttachmentWrites').mockReturnValue(letGo);
		const save = deferred<void>();
		vi.spyOn(idb, 'saveNote').mockImplementation(() => save.promise as never);
		notesStore.createNote({ title: 'Photo', images: [photo('shot')] });
		expect(idb.holdAttachmentWrites).toHaveBeenCalledOnce();

		// Deleted, or the window moved to another workspace, while the save was under way.
		notesStore.notes = [];
		save.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Held on, every sync of the workspace would wait for it for good.
		expect(letGo).toHaveBeenCalled();
	});

	it('writes over no other note when the list changed while the saved photo was shrunk', async () => {
		const shrunk = deferred<string | null>();
		vi.mocked(makeImageThumbDataUrl).mockImplementationOnce(() => shrunk.promise);
		const withPhoto = notesStore.createNote({ title: 'Photo', images: [photo('shot')] });
		await vi.waitFor(() => expect(makeImageThumbDataUrl).toHaveBeenCalled());

		const newer = notesStore.createNote({ title: 'Newer' });
		shrunk.resolve('data:image/jpeg;base64,/9j/2Q==');
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(notesStore.notes.find((note) => note.id === newer.id)?.title).toBe('Newer');
		expect(notesStore.notes.find((note) => note.id === withPhoto.id)?.title).toBe('Photo');
		expect(notesStore.notes).toHaveLength(2);
	});
});
