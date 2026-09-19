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

		const shrink = getByRole('button', { name: 'Shrink note' });
		expect(shrink.getAttribute('aria-pressed')).toBe('true');
		expect(sheet.className).toMatch(/max-w_none/);
		expect(document.documentElement.classList.contains('editor-expanded')).toBe(true);
	});

	it('paints safe-area background and theme-color on open, cleaning up on unmount', async () => {
		notesStore.notes = [note({ color: 'yellow' })];
		const { unmount } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		expect(document.documentElement.style.getPropertyValue('--editor-page-bg')).not.toBe('');
		expect(uiStore.themeColorOverride).not.toBeNull();

		unmount();

		expect(document.documentElement.style.getPropertyValue('--editor-page-bg')).toBe('');
		expect(uiStore.themeColorOverride).toBeNull();
		expect(document.documentElement.classList.contains('editor-expanded')).toBe(false);
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
