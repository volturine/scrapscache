import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '$lib/types';
import { notesStore } from '$lib/stores/notes.svelte';
import { uiStore } from '$lib/stores/ui.svelte';
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
	uiStore.editorExpanded = false;
});

describe('NoteEditor Keep-style layout', () => {
	it('docks the merged files-and-links list and the photo strip below the body scroller', () => {
		notesStore.notes = [note()];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		const scroller = container.querySelector('.note-scrollbar-hidden');
		const filesAndLinks = container.querySelector('[aria-label="Files and links"]');
		const photos = container.querySelector('[aria-label="Photos"]');

		expect(scroller).toBeTruthy();
		expect(filesAndLinks).toBeTruthy();
		expect(photos).toBeTruthy();
		// Both live outside the body scroller, in their own scrollable strips.
		expect(scroller!.contains(filesAndLinks)).toBe(false);
		expect(scroller!.contains(photos)).toBe(false);
		// URLs share the file rows' vertical list, with the scrollbar hidden.
		expect(filesAndLinks!.className).toMatch(/ov-y_auto/);
		expect(filesAndLinks!.className).toMatch(/note-scrollbar-hidden/);
		expect(filesAndLinks!.className).not.toMatch(/ov-x_auto/);
		expect(photos!.className).toMatch(/ov-x_auto/);
		expect(
			filesAndLinks!.compareDocumentPosition(photos!) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it('stacks multiple links as rows in the merged files-and-links list', () => {
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
		const filesAndLinks = container.querySelector('[aria-label="Files and links"]');

		expect(scroller).toBeTruthy();
		expect(title).toBeTruthy();
		expect(filesAndLinks).toBeTruthy();
		expect(scroller!.contains(title)).toBe(true);
		expect(scroller!.contains(filesAndLinks)).toBe(false);
		expect(filesAndLinks!.children.length).toBe(4);
		// One row each, stacked vertically rather than side by side.
		expect(filesAndLinks!.children[0]!.tagName).toBe('LI');
		expect(
			title!.compareDocumentPosition(filesAndLinks!) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it('lets the photo strip pan sideways on touch', () => {
		notesStore.notes = [note({ body: '' })];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		const photos = container.querySelector('[aria-label="Photos"]')!;
		// The global .scrollable class restricts touch to vertical pans.
		expect(photos.classList.contains('scrollable')).toBe(false);
		expect(photos.className).toMatch(/_pan-x_pan-y/);
	});

	it('toggles the expanded note sheet from the header', async () => {
		notesStore.notes = [note()];
		const { getByRole } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		const expand = getByRole('button', { name: 'Expand note' });
		const sheet = getByRole('dialog').parentElement!;
		expect(expand.getAttribute('aria-pressed')).toBe('false');
		expect(sheet.className).toMatch(/max-w_2xl/);

		await fireEvent.click(expand);

		expect(uiStore.editorExpanded).toBe(true);
		const shrink = getByRole('button', { name: 'Shrink note' });
		expect(shrink.getAttribute('aria-pressed')).toBe('true');
		expect(sheet.className).toMatch(/max-w_none/);
		expect(document.documentElement.classList.contains('editor-expanded')).toBe(true);
	});
});
