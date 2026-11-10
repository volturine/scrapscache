import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteImage } from '#lib/types.js';
import { sortAttachments } from '#lib/model/merge.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { syncStore } from '#lib/stores/sync.svelte.js';
import NoteEditorFooter from './NoteEditorFooter.svelte';

const conversion = vi.hoisted(() => ({
	fileToNoteImage: vi.fn(),
	noteImageFromCroppedDataUrl: vi.fn()
}));
vi.mock('#lib/noteImages.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/noteImages.js')>()),
	fileToNoteImage: conversion.fileToNoteImage,
	noteImageFromCroppedDataUrl: conversion.noteImageFromCroppedDataUrl
}));
vi.mock('@ark-ui/svelte/image-cropper', async (importOriginal) => {
	const original = await importOriginal<typeof import('@ark-ui/svelte/image-cropper')>();
	const { default: Context } = await import('./PhotoFullscreen.cropper-context.svelte');
	return { ...original, ImageCropper: { ...original.ImageCropper, Context } };
});

const DATA_URL = 'data:image/webp;base64,YWJj';

function image(id: string, contentHash: string, byteSize = 3): NoteImage {
	return {
		id,
		mime: 'image/webp',
		dataUrl: DATA_URL,
		thumbUrl: DATA_URL,
		name: 'picked.webp',
		createdAt: 1,
		contentHash,
		byteSize
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

async function chooseCompressed() {
	await fireEvent.click(await screen.findByRole('button', { name: /^Compressed/ }));
}

describe('NoteEditorFooter attachment work', () => {
	beforeEach(() => conversion.fileToNoteImage.mockReset());

	it('keeps successful siblings when one DNG conversion fails', async () => {
		const onImagesChange = vi.fn();
		conversion.fileToNoteImage.mockImplementation(async (file?: File) => {
			if (!file) return image('unexpected-call', 'unexpected-call');
			if (file.name.endsWith('.dng')) throw new Error('Invalid DNG header');
			return image('good-photo', 'good-hash');
		});
		const { component } = render(NoteEditorFooter, { props: { onImagesChange } });
		const good = new File(['png'], 'good.png', { type: 'image/png' });
		const bad = new File(['bad'], 'bad.dng', { type: 'image/dng' });

		component.handlePickedFiles([good, bad]);
		await chooseCompressed();
		await component.waitForPendingAttachments();

		expect(onImagesChange).toHaveBeenCalledTimes(1);
		expect(onImagesChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'good-photo' })]);
		expect(screen.getByText(/bad\.dng could not be processed: Invalid DNG header/)).toBeTruthy();
	});

	it('keeps picker order when conversions finish in the same millisecond', async () => {
		const onImagesChange = vi.fn();
		conversion.fileToNoteImage
			.mockResolvedValueOnce(image('z-first', 'first'))
			.mockResolvedValueOnce(image('a-second', 'second'));
		const { component } = render(NoteEditorFooter, { props: { onImagesChange } });
		component.handlePickedFiles([
			new File(['a'], 'first.png', { type: 'image/png' }),
			new File(['b'], 'second.png', { type: 'image/png' })
		]);
		await chooseCompressed();
		await component.waitForPendingAttachments();
		const added = onImagesChange.mock.calls[0][0] as NoteImage[];
		expect(added[0].createdAt).toBeLessThan(added[1].createdAt);
		expect(sortAttachments(added).map((photo) => photo.id)).toEqual(['z-first', 'a-second']);
	});

	it('serializes accepted picks so repeated identical photos deduplicate', async () => {
		const first = deferred<NoteImage>();
		const second = deferred<NoteImage>();
		const onImagesChange = vi.fn();
		conversion.fileToNoteImage
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const { component } = render(NoteEditorFooter, { props: { onImagesChange } });
		const firstPick = new File(['same'], 'same.png', { type: 'image/png' });
		const secondPick = new File(['same'], 'same.png', { type: 'image/png' });

		component.handlePickedFiles([firstPick]);
		await chooseCompressed();
		await waitFor(() => expect(conversion.fileToNoteImage).toHaveBeenCalledTimes(1));
		component.handlePickedFiles([secondPick]);
		await chooseCompressed();

		first.resolve(image('first-photo', 'same-content'));
		await waitFor(() => expect(conversion.fileToNoteImage).toHaveBeenCalledTimes(2));
		second.resolve(image('second-photo', 'same-content'));
		await component.waitForPendingAttachments();

		expect(onImagesChange).toHaveBeenCalledTimes(1);
		expect(onImagesChange.mock.calls[0][0]).toHaveLength(1);
		expect(onImagesChange.mock.calls[0][0][0].id).toBe('first-photo');
	});

	it('rejects an oversized converted attachment even when its source is small', async () => {
		const onImagesChange = vi.fn();
		conversion.fileToNoteImage.mockResolvedValue(
			image('too-large', 'too-large-hash', 8 * 1024 * 1024 + 1)
		);
		const { component } = render(NoteEditorFooter, { props: { onImagesChange } });

		component.handlePickedFiles([new File(['tiny'], 'photo.png', { type: 'image/png' })]);
		await chooseCompressed();
		await component.waitForPendingAttachments();

		expect(onImagesChange).not.toHaveBeenCalled();
		expect(screen.getByText(/photo\.png is .* after processing/)).toBeTruthy();
	});

	it('suppresses late callbacks after the footer is destroyed', async () => {
		const pending = deferred<NoteImage>();
		const onImagesChange = vi.fn();
		conversion.fileToNoteImage.mockReturnValue(pending.promise);
		const { component, unmount } = render(NoteEditorFooter, { props: { onImagesChange } });
		component.handlePickedFiles([new File(['png'], 'photo.png', { type: 'image/png' })]);
		await chooseCompressed();
		await waitFor(() => expect(conversion.fileToNoteImage).toHaveBeenCalledTimes(1));

		const drain = component.waitForPendingAttachments();
		unmount();
		pending.resolve(image('late-photo', 'late-hash'));
		await drain;

		expect(onImagesChange).not.toHaveBeenCalled();
	});

	it('suppresses a late result after the active profile changes', async () => {
		const pending = deferred<NoteImage>();
		const onImagesChange = vi.fn();
		const originalProfileId = syncStore.activeId;
		conversion.fileToNoteImage.mockReturnValue(pending.promise);
		const { component } = render(NoteEditorFooter, { props: { onImagesChange } });
		component.handlePickedFiles([new File(['png'], 'photo.png', { type: 'image/png' })]);
		await chooseCompressed();
		await waitFor(() => expect(conversion.fileToNoteImage).toHaveBeenCalledTimes(1));

		const drain = component.waitForPendingAttachments();
		syncStore.activeId = 'different-profile';
		pending.resolve(image('late-photo', 'late-hash'));
		await drain;
		syncStore.activeId = originalProfileId;

		expect(onImagesChange).not.toHaveBeenCalled();
	});

	it('gives the photo’s chip the name a crop gave the photo', async () => {
		const before = { ...image('photo-1', 'before-hash'), mime: 'image/png', name: 'beach.png' };
		const after = { ...before, mime: 'image/webp', name: 'beach.webp', contentHash: 'after-hash' };
		conversion.noteImageFromCroppedDataUrl.mockResolvedValue(after);
		const stored = {
			id: 'note-1',
			body: 'Trip\n![beach.png](photo:photo-1)',
			images: [before]
		} as (typeof notesStore.notes)[number];
		const originalNotes = notesStore.notes;
		notesStore.notes = [stored];
		const flushNote = vi.spyOn(notesStore, 'flushNote').mockResolvedValue();
		const hydrate = vi.spyOn(notesStore, 'ensureNoteAttachments').mockResolvedValue();
		const { component } = render(NoteEditorFooter, {
			props: { noteId: 'note-1', images: [before] }
		});

		await component.openPhoto('photo-1');
		await fireEvent.click(await screen.findByRole('button', { name: 'Crop photo' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Apply crop' }));

		await waitFor(() =>
			expect(flushNote).toHaveBeenCalledWith('note-1', {
				images: [after],
				body: 'Trip\n![beach.webp](photo:photo-1)'
			})
		);
		flushNote.mockRestore();
		hydrate.mockRestore();
		notesStore.notes = originalNotes;
	});

	it('removes the one-shot picker on destroy', async () => {
		const { component, unmount } = render(NoteEditorFooter);
		component.openAttach();
		const input = document.querySelector('input[type="file"]');
		expect(input).toBeTruthy();

		unmount();
		await Promise.resolve();

		expect(input?.isConnected).toBe(false);
	});
});
