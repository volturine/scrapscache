import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
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
});
