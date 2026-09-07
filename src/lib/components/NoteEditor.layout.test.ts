import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '$lib/types';
import { notesStore } from '$lib/stores/notes.svelte';
import NoteEditor from './NoteEditor.svelte';

const PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'Wasm',
		body: 'shopify uses it\nhttps://webassembly.org/',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		images: [
			{
				id: 'photo-1',
				mime: 'image/png',
				dataUrl: PNG,
				name: 'who-wins.png',
				createdAt: 1
			}
		],
		...partial
	};
}

beforeEach(() => {
	vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	notesStore.notes = [];
	notesStore.labels = [];
});

describe('NoteEditor Keep-style layout', () => {
	it('docks link previews and a horizontal photo strip below the body scroller', () => {
		notesStore.notes = [note()];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		const scroller = container.querySelector('.note-scrollbar-hidden');
		const links = container.querySelector('[aria-label="Links"]');
		const photos = container.querySelector('[aria-label="Photos"]');

		expect(scroller).toBeTruthy();
		expect(links).toBeTruthy();
		expect(photos).toBeTruthy();
		expect(scroller!.contains(links)).toBe(false);
		expect(scroller!.contains(photos)).toBe(false);
		expect(photos!.className).toMatch(/overflow-x-auto/);
		expect(photos!.className).not.toMatch(/grid-cols-3/);
		expect(links!.compareDocumentPosition(photos!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});
