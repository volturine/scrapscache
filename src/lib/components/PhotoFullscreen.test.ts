import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PhotoFullscreen from './PhotoFullscreen.svelte';
import { cropperHarness } from './PhotoFullscreen.cropperMock.js';

const saved = vi.hoisted(() => ({
	saveAttachment: vi.fn(async () => {}),
	noteImageFromCroppedDataUrl: vi.fn()
}));
vi.mock('#lib/noteImages.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('#lib/noteImages.js')>();
	return {
		...original,
		saveAttachment: saved.saveAttachment,
		noteImageFromCroppedDataUrl: saved.noteImageFromCroppedDataUrl
	};
});
vi.mock('@ark-ui/svelte/image-cropper', async (importOriginal) => {
	const original = await importOriginal<typeof import('@ark-ui/svelte/image-cropper')>();
	const { default: Context } = await import('./PhotoFullscreen.cropper-context.svelte');
	return { ...original, ImageCropper: { ...original.ImageCropper, Context } };
});
import type { NoteImage } from '#lib/types.js';

const PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function photo(id: string, name: string): NoteImage {
	return { id, mime: 'image/png', dataUrl: PNG, name, createdAt: 1 };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe('PhotoFullscreen', () => {
	beforeEach(() => {
		saved.saveAttachment.mockReset().mockResolvedValue(undefined);
		saved.noteImageFromCroppedDataUrl.mockReset();
		cropperHarness.getCroppedImage = async () => 'data:image/webp;base64,YWJj';
	});

	it('shows a close control and the photo without a thumbnail strip for one image', () => {
		render(PhotoFullscreen, {
			props: { images: [photo('a', 'one.png')], activeIndex: 0 }
		});

		expect(document.body.querySelector('[aria-label="Photo"]')).toBeTruthy();
		expect(document.body.querySelector('[aria-label="Close photo"]')).toBeTruthy();
		expect(document.body.querySelector('[aria-label="Photo thumbnails"]')).toBeNull();
		expect(document.body.querySelector('img[alt="one.png"]')).toBeTruthy();
	});

	it('shows thumbnails for multiple photos and switches on click', async () => {
		render(PhotoFullscreen, {
			props: {
				images: [photo('a', 'one.png'), photo('b', 'two.png')],
				activeIndex: 0
			}
		});

		expect(document.body.querySelector('[aria-label="Photo thumbnails"]')).toBeTruthy();
		expect(document.body.querySelector('img[alt="one.png"]')).toBeTruthy();

		const second = document.body.querySelector('[aria-label="two.png"]');
		expect(second).toBeTruthy();
		await fireEvent.click(second!);

		expect(document.body.querySelector('img[alt="two.png"]')).toBeTruthy();
	});

	it('closes on Escape and the close button', async () => {
		render(PhotoFullscreen, {
			props: { images: [photo('a', 'one.png')], activeIndex: 0 }
		});

		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(document.body.querySelector('[aria-label="Photo"]')).toBeNull();
	});

	it('hides crop unless a crop handler is provided', () => {
		render(PhotoFullscreen, {
			props: { images: [photo('a', 'one.png')], activeIndex: 0 }
		});
		expect(document.body.querySelector('[aria-label="Crop photo"]')).toBeNull();
	});

	it('keeps the cropped photo selected when saving reorders attachments', async () => {
		const first = photo('z', 'first.png');
		const second = photo('a', 'second.png');
		saved.noteImageFromCroppedDataUrl.mockResolvedValue(first);
		const view = render(PhotoFullscreen, {
			props: {
				images: [first, second],
				activeIndex: 0,
				onCrop: async () => {
					await view.rerender({ images: [second, first] });
				}
			}
		});
		await fireEvent.click(view.getByRole('button', { name: 'Crop photo' }));
		await fireEvent.click(view.getByRole('button', { name: 'Apply crop' }));
		await waitFor(() =>
			expect(document.body.querySelector('[aria-label="Photo"] header')?.textContent).toContain(
				'first.png'
			)
		);
	});

	it('shows download button and delete button when onDelete is provided', async () => {
		const onDelete = vi.fn();
		render(PhotoFullscreen, {
			props: {
				images: [photo('a', 'one.png'), photo('b', 'two.png')],
				activeIndex: 0,
				onDelete
			}
		});

		expect(document.body.querySelector('[aria-label="Download photo"]')).toBeTruthy();
		const deleteBtn = document.body.querySelector('[aria-label="Delete photo"]');
		expect(deleteBtn).toBeTruthy();

		await fireEvent.click(deleteBtn!);
		expect(onDelete).toHaveBeenCalledWith('a');
	});

	it('keeps the photo open and reports a failed delete', async () => {
		const onDelete = vi.fn(async () => false);
		render(PhotoFullscreen, {
			props: { images: [photo('a', 'one.png')], activeIndex: 0, onDelete }
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Delete photo' }));
		await waitFor(() =>
			expect(screen.getByRole('alert').textContent).toContain('Could not delete')
		);

		expect(document.body.querySelector('[aria-label="Photo"]')).toBeTruthy();
		expect(document.body.querySelector('img[alt="one.png"]')).toBeTruthy();
	});

	it('waits for the last delete to succeed before closing the viewer', async () => {
		const pending = deferred<boolean>();
		const onDelete = vi.fn(() => pending.promise);
		render(PhotoFullscreen, {
			props: { images: [photo('a', 'one.png')], activeIndex: 0, onDelete }
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Delete photo' }));
		expect(document.body.querySelector('[aria-label="Photo"]')).toBeTruthy();
		pending.resolve(true);
		await waitFor(() => expect(document.body.querySelector('[aria-label="Photo"]')).toBeNull());
	});

	it('shows navigation chevrons for multiple photos', async () => {
		render(PhotoFullscreen, {
			props: {
				images: [photo('a', 'one.png'), photo('b', 'two.png')],
				activeIndex: 0
			}
		});

		const nextBtn = document.body.querySelector('[aria-label="Next photo"]');
		const prevBtn = document.body.querySelector('[aria-label="Previous photo"]');
		expect(nextBtn).toBeTruthy();
		expect(prevBtn).toBeTruthy();

		await fireEvent.click(nextBtn!);
		expect(document.body.querySelector('img[alt="two.png"]')).toBeTruthy();
	});

	it('renders rotate, undo, reset, and aspect ratio controls inside cropper', async () => {
		render(PhotoFullscreen, {
			props: { images: [photo('a', 'one.png')], activeIndex: 0, onCrop: () => {} }
		});

		await fireEvent.click(document.body.querySelector('[aria-label="Crop photo"]')!);
		expect(document.body.querySelector('[data-scope="image-cropper"]')).toBeTruthy();
		const rotateBtn = document.body.querySelector(
			'[aria-label="Rotate 90 degrees"]'
		) as HTMLButtonElement;
		const undoBtn = document.body.querySelector(
			'[aria-label="Undo crop adjustment"]'
		) as HTMLButtonElement;
		const resetBtn = document.body.querySelector('[aria-label="Reset crop"]') as HTMLButtonElement;

		expect(rotateBtn).toBeTruthy();
		expect(undoBtn).toBeTruthy();
		expect(resetBtn).toBeTruthy();
		expect(undoBtn.disabled).toBe(true);

		await fireEvent.click(rotateBtn);
		expect(undoBtn.disabled).toBe(false);

		await fireEvent.click(undoBtn);
		expect(undoBtn.disabled).toBe(true);

		await fireEvent.click(resetBtn);
		expect(document.body.querySelector('[aria-label="Aspect ratio presets"]')).toBeTruthy();
		expect(document.body.textContent).toContain('Apply');

		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(document.body.querySelector('[data-scope="image-cropper"]')).toBeNull();
		expect(document.body.querySelector('[aria-label="Photo"]')).toBeTruthy();
	});

	it('does not save a crop after Escape cancels its pending conversion', async () => {
		const cropResult = deferred<unknown>();
		const croppedImage = deferred<NoteImage>();
		const onCrop = vi.fn();
		cropperHarness.getCroppedImage = vi.fn(() => cropResult.promise);
		saved.noteImageFromCroppedDataUrl.mockReturnValue(croppedImage.promise);
		render(PhotoFullscreen, {
			props: { images: [photo('a', 'one.png')], activeIndex: 0, onCrop }
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Crop photo' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Apply crop' }));
		await waitFor(() => expect(cropperHarness.getCroppedImage).toHaveBeenCalled());
		cropResult.resolve('data:image/webp;base64,YWJj');
		await waitFor(() => expect(saved.noteImageFromCroppedDataUrl).toHaveBeenCalled());

		await fireEvent.keyDown(window, { key: 'Escape' });
		croppedImage.resolve(photo('a', 'one.webp'));
		await Promise.resolve();

		expect(onCrop).not.toHaveBeenCalled();
		expect(document.body.querySelector('[aria-label="Crop photo"]')).toBeTruthy();
	});

	it('saves the full photo through the device’s save path, and waits while it loads', async () => {
		const loaded = photo('a', 'one.png');
		render(PhotoFullscreen, { props: { images: [loaded], activeIndex: 0 } });
		const download = document.body.querySelector<HTMLButtonElement>(
			'[aria-label="Download photo"]'
		)!;
		expect(download.disabled).toBe(false);
		await fireEvent.click(download);
		expect(saved.saveAttachment).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
	});

	it('cannot save a photo whose bytes are not here yet', () => {
		const thumbOnly = { ...photo('b', 'two.png'), dataUrl: '', thumbUrl: PNG };
		render(PhotoFullscreen, { props: { images: [thumbOnly], activeIndex: 0 } });
		const download = document.body.querySelector<HTMLButtonElement>(
			'[aria-label="Download photo"]'
		)!;
		expect(download.disabled).toBe(true);
	});
});
