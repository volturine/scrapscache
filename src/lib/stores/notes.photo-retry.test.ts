import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/imageThumb.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/imageThumb.js')>();
	return { ...actual, makeImageThumbDataUrl: vi.fn(async () => null) };
});

import * as idb from '#lib/db/idb.js';
import type { NoteImage } from '#lib/types.js';
import { notesStore } from './notes.svelte';
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

	afterEach(() => {
		vi.restoreAllMocks();
		const internals = notesStore as unknown as {
			dirty: boolean;
			syncPushTimer: ReturnType<typeof setTimeout> | null;
			noteRetryTimers: Map<string, ReturnType<typeof setTimeout>>;
			noteRetryAttempts: Map<string, number>;
		};
		if (internals.syncPushTimer) clearTimeout(internals.syncPushTimer);
		internals.syncPushTimer = null;
		internals.dirty = false;
		for (const timer of internals.noteRetryTimers.values()) clearTimeout(timer);
		internals.noteRetryTimers.clear();
		internals.noteRetryAttempts.clear();
		notesStore.notes = [];
		notesStore.lastPersistError = null;
	});

	it('keeps a photo in memory until its own save has landed', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const earlierSave = deferred<void>();
		const putNote = vi
			.spyOn(idb, 'putNote')
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

	it('still releases the bytes once the photo itself is durable', async () => {
		const created = notesStore.createNote({ title: 'Photo', images: [photo('shot')] });
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
});
