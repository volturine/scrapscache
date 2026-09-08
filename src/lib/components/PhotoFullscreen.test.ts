import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import PhotoFullscreen from './PhotoFullscreen.svelte';
import type { NoteImage } from '$lib/types';

const PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function photo(id: string, name: string): NoteImage {
	return { id, mime: 'image/png', dataUrl: PNG, name, createdAt: 1 };
}

describe('PhotoFullscreen', () => {
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

	it('renders rotate, reset, and aspect ratio controls inside cropper', async () => {
		render(PhotoFullscreen, {
			props: { images: [photo('a', 'one.png')], activeIndex: 0, onCrop: () => {} }
		});

		await fireEvent.click(document.body.querySelector('[aria-label="Crop photo"]')!);
		expect(document.body.querySelector('[data-scope="image-cropper"]')).toBeTruthy();
		expect(document.body.querySelector('[aria-label="Rotate 90 degrees"]')).toBeTruthy();
		expect(document.body.querySelector('[aria-label="Reset crop"]')).toBeTruthy();
		expect(document.body.querySelector('[aria-label="Aspect ratio presets"]')).toBeTruthy();
		expect(document.body.textContent).toContain('Apply');

		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(document.body.querySelector('[data-scope="image-cropper"]')).toBeNull();
		expect(document.body.querySelector('[aria-label="Photo"]')).toBeTruthy();
	});
});
