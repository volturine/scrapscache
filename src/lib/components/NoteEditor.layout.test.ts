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
	it('docks link previews and the photo strip below the body scroller as sibling strips', () => {
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
		// Links live outside the body scroller, in their own scrollable strip.
		expect(scroller!.contains(links)).toBe(false);
		expect(scroller!.contains(photos)).toBe(false);
		expect(links!.className).toMatch(/overflow-x-auto/);
		expect(photos!.className).toMatch(/overflow-x-auto/);
		expect(links!.compareDocumentPosition(photos!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('keeps multiple link previews side by side in the docked strip', () => {
		notesStore.notes = [
			note({
				body: 'Multiple links:\nhttps://one.example.com\nhttps://two.example.com\nhttps://three.example.com\nhttps://four.example.com'
			})
		];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		const scroller = container.querySelector('.note-scrollbar-hidden');
		const title = container.querySelector('textarea[placeholder="Title"]');
		const links = container.querySelector('[aria-label="Links"]');

		expect(scroller).toBeTruthy();
		expect(title).toBeTruthy();
		expect(links).toBeTruthy();
		expect(scroller!.contains(title)).toBe(true);
		expect(scroller!.contains(links)).toBe(false);
		expect(links!.children.length).toBe(4);
		// One card each, side by side rather than stacked.
		expect(links!.children[0]!.className).toMatch(/shrink-0/);
		expect(title!.compareDocumentPosition(links!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});
