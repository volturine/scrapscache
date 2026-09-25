import { fireEvent, render, waitFor } from '@testing-library/svelte';
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
	it('docks the merged files-and-links list and the photo strip below the body scroller', async () => {
		notesStore.notes = [note()];
		const { container, getByRole } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		// Previews start collapsed behind the footer-line toggle.
		await fireEvent.click(getByRole('button', { name: 'Show previews' }));

		const scroller = container.querySelector('.note-scrollbar-hidden');
		const filesAndLinks = container.querySelector('[aria-label="Files and links"]');
		const photos = container.querySelector('[aria-label="Photos"]');

		expect(scroller).toBeTruthy();
		expect(filesAndLinks).toBeTruthy();
		expect(photos).toBeTruthy();
		// Both live outside the body scroller, in their own scrollable strips.
		expect(scroller!.contains(filesAndLinks)).toBe(false);
		expect(scroller!.contains(photos)).toBe(false);
		// The body scroller expands to fill available dialog space.
		expect(scroller!.className).toMatch(/flex_1/);
		expect(scroller!.className).toMatch(/ov-y_auto/);
		// URLs share the file rows' vertical list, with the scrollbar hidden.
		expect(filesAndLinks!.className).toMatch(/ov-y_auto/);
		expect(filesAndLinks!.className).toMatch(/note-scrollbar-hidden/);
		expect(filesAndLinks!.className).not.toMatch(/ov-x_auto/);
		expect(photos!.className).toMatch(/ov-x_auto/);
		expect(
			filesAndLinks!.compareDocumentPosition(photos!) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it('stacks multiple links as rows in the merged files-and-links list', async () => {
		notesStore.notes = [
			note({
				body: 'Multiple links:\nhttps://one.example.com\nhttps://two.example.com\nhttps://three.example.com\nhttps://four.example.com'
			})
		];
		const { container, getByRole } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		await fireEvent.click(getByRole('button', { name: 'Show previews' }));

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

	it('keeps the photo strip open without a toggle in fill mode', () => {
		notesStore.notes = [note({ body: '' })];
		const { container, queryByRole } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		// Fill mode forces the panel open, so there is nothing for the toggle to do.
		expect(queryByRole('button', { name: 'Show previews' })).toBeNull();
		expect(queryByRole('button', { name: 'Hide previews' })).toBeNull();
		expect(container.querySelector('[data-preview-panel]')).toBeTruthy();
		expect(container.querySelector('[aria-label="Photos"]')).toBeTruthy();
	});

	it('expands previews as a card that carries its toggle on its top edge', async () => {
		notesStore.notes = [note()];
		const { container, getByRole, queryByRole } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		// Collapsed by default: content hidden, toggle alone in the empty dock
		// right above the footer, so it sits on the footer line.
		const dock = container.querySelector('[data-preview-dock]');
		expect(dock?.nextElementSibling?.tagName).toBe('FOOTER');
		expect(container.querySelector('[data-preview-panel]')).toBeNull();
		expect(container.querySelector('[aria-label="Files and links"]')).toBeNull();
		const show = getByRole('button', { name: 'Show previews' });
		expect(show.getAttribute('aria-expanded')).toBe('false');
		expect(dock!.contains(show)).toBe(true);
		expect(container.querySelector('footer')!.contains(show)).toBe(false);

		await fireEvent.click(show);

		// The card opens inside the same dock, below the toggle, so the toggle
		// rides the card's top edge instead of staying on the footer line.
		const panel = container.querySelector('[data-preview-panel]');
		expect(panel?.parentElement).toBe(dock);
		expect(container.querySelector('[aria-label="Files and links"]')).toBeTruthy();
		const hide = getByRole('button', { name: 'Hide previews' });
		expect(hide.getAttribute('aria-expanded')).toBe('true');
		expect(hide.compareDocumentPosition(panel!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

		await fireEvent.click(hide);

		await waitFor(() => expect(container.querySelector('[data-preview-panel]')).toBeNull());
		expect(queryByRole('button', { name: 'Show previews' })).toBeTruthy();
	});

	it('summarises what the collapsed toggle hides', () => {
		notesStore.notes = [note()];
		const { getByRole } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		// One link and one photo in the fixture note.
		expect(getByRole('button', { name: 'Show previews' }).textContent?.replace(/\s/g, '')).toBe(
			'11'
		);
	});

	it('hides the toggle when a note has nothing to preview', () => {
		notesStore.notes = [note({ body: 'Plain note', images: [] })];
		const { queryByRole } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		expect(queryByRole('button', { name: 'Show previews' })).toBeNull();
		expect(queryByRole('button', { name: 'Hide previews' })).toBeNull();
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

		const shrink = getByRole('button', { name: 'Shrink note' });
		expect(shrink.getAttribute('aria-pressed')).toBe('true');
		expect(sheet.className).toMatch(/max-w_none/);
		expect(document.documentElement.classList.contains('editor-expanded')).toBe(true);
	});

	describe('auto-expand', () => {
		function layOut(dialogHeight: number) {
			vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
				this: HTMLElement
			) {
				return this.getAttribute('role') === 'dialog' ? dialogHeight : 0;
			});
			vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
				this: HTMLElement
			) {
				return this.matches('[role="dialog"] > header, [role="dialog"] > footer') ? 50 : 0;
			});
			const computed = window.getComputedStyle;
			vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
				const style = computed(el, pseudo);
				if (!(el as Element).matches('[data-body-editor]')) return style;
				return new Proxy(style, {
					get: (target, key) => (key === 'lineHeight' ? '24px' : Reflect.get(target, key))
				});
			});
		}

		it('expands when the note area fits eight body lines or fewer', async () => {
			layOut(100 + 8 * 24);
			notesStore.notes = [note()];
			const { getByRole } = render(NoteEditor, {
				props: { noteId: 'note-1', onClose: () => {} }
			});

			await vi.waitFor(() => expect(getByRole('button', { name: 'Shrink note' })).toBeTruthy());

			await fireEvent.click(getByRole('button', { name: 'Shrink note' }));
			expect(getByRole('button', { name: 'Expand note' })).toBeTruthy();
		});

		it('keeps the normal sheet when more than eight lines fit', async () => {
			layOut(100 + 9 * 24);
			notesStore.notes = [note()];
			const { getByRole } = render(NoteEditor, {
				props: { noteId: 'note-1', onClose: () => {} }
			});

			await new Promise((resolve) => requestAnimationFrame(resolve));
			await new Promise((resolve) => requestAnimationFrame(resolve));
			expect(getByRole('button', { name: 'Expand note' })).toBeTruthy();
		});
	});
});
