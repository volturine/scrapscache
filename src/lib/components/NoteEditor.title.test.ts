import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '$lib/types';
import { notesStore } from '$lib/stores/notes.svelte';
import NoteEditor from './NoteEditor.svelte';
import NoteCard from './NoteCard.svelte';
import KanbanCard from './KanbanCard.svelte';

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'A long title that wraps nicely in the interface',
		body: 'Note body content',
		color: 'green',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
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

describe('Title wrapping and single-line preservation', () => {
	it('renders note title as a wrapping auto-resizing textarea in NoteEditor', async () => {
		notesStore.notes = [note({ title: 'A very long note title that wraps across multiple lines' })];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		const titleElement = container.querySelector(
			'textarea[placeholder="Title"]'
		) as HTMLTextAreaElement;
		expect(titleElement).not.toBeNull();
		expect(titleElement.tagName).toBe('TEXTAREA');
		expect(titleElement.value).toBe('A very long note title that wraps across multiple lines');
		expect(titleElement.getAttribute('rows')).toBe('1');
		expect(titleElement.className).toContain('resize-none');
		expect(titleElement.className).toContain('break-words');
	});

	it('moves to note body on Enter and does not insert newlines on Enter or Shift+Enter', async () => {
		notesStore.notes = [note()];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		const titleElement = container.querySelector(
			'textarea[placeholder="Title"]'
		) as HTMLTextAreaElement;
		expect(titleElement).not.toBeNull();

		// Enter -> default prevented so newline is never inserted and focus moves to body
		const enterEvent = new KeyboardEvent('keydown', {
			key: 'Enter',
			cancelable: true,
			bubbles: true
		});
		titleElement.dispatchEvent(enterEvent);
		expect(enterEvent.defaultPrevented).toBe(true);

		// Shift+Enter -> also default prevented so title remains strictly single line
		const shiftEnterEvent = new KeyboardEvent('keydown', {
			key: 'Enter',
			shiftKey: true,
			cancelable: true,
			bubbles: true
		});
		titleElement.dispatchEvent(shiftEnterEvent);
		expect(shiftEnterEvent.defaultPrevented).toBe(true);
	});

	it('replaces pasted or input newlines with spaces to keep title single-line', async () => {
		notesStore.notes = [note({ title: 'Initial' })];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		const titleElement = container.querySelector(
			'textarea[placeholder="Title"]'
		) as HTMLTextAreaElement;
		expect(titleElement).not.toBeNull();

		await fireEvent.input(titleElement, { target: { value: 'Line One\nLine Two\r\nLine Three' } });
		expect(titleElement.value).toBe('Line One Line Two Line Three');
	});

	it('auto-resizes textarea when content changes', async () => {
		notesStore.notes = [note({ title: 'Initial' })];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		const titleElement = container.querySelector(
			'textarea[placeholder="Title"]'
		) as HTMLTextAreaElement;
		Object.defineProperty(titleElement, 'scrollHeight', {
			configurable: true,
			value: 72
		});

		await fireEvent.input(titleElement, { target: { value: 'A very long wrapped title' } });
		expect(titleElement.style.height).toBe('72px');
	});

	it('renders title with break-words in NoteCard for soft wrapping', () => {
		const testNote = note({ title: 'VeryLongWordWithoutSpacesWrappingProperly' });
		const { container } = render(NoteCard, {
			props: { note: testNote, onOpen: () => {} }
		});

		const titleEl = container.querySelector('h3');
		expect(titleEl).not.toBeNull();
		expect(titleEl?.textContent?.trim()).toBe('VeryLongWordWithoutSpacesWrappingProperly');
		expect(titleEl?.className).toContain('break-words');
		expect(titleEl?.className).not.toContain('whitespace-pre-wrap');
	});

	it('renders title with break-words in KanbanCard for soft wrapping', () => {
		const testNote = note({ title: 'Column Title Soft Wrapping' });
		const { container } = render(KanbanCard, {
			props: {
				note: testNote,
				columnId: 'col-1',
				index: 0,
				onOpen: () => {},
				onDrop: () => {}
			}
		});

		const titleEl = container.querySelector('h3');
		expect(titleEl).not.toBeNull();
		expect(titleEl?.textContent?.trim()).toBe('Column Title Soft Wrapping');
		expect(titleEl?.className).toContain('break-words');
		expect(titleEl?.className).not.toContain('whitespace-pre-wrap');
	});
});
