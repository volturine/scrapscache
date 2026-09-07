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
		title: 'Line 1\nLine 2',
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

describe('Multiline title support', () => {
	it('renders note title as a multiline textarea in NoteEditor', async () => {
		notesStore.notes = [note({ title: 'Multiline\nTitle\nTest' })];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		const titleElement = container.querySelector(
			'textarea[placeholder="Title"]'
		) as HTMLTextAreaElement;
		expect(titleElement).not.toBeNull();
		expect(titleElement.tagName).toBe('TEXTAREA');
		expect(titleElement.value).toBe('Multiline\nTitle\nTest');
		expect(titleElement.getAttribute('rows')).toBe('1');
		expect(titleElement.className).toContain('resize-none');
		expect(titleElement.className).toContain('break-words');
	});

	it('moves to note body on Enter without Shift, but allows newlines on Shift+Enter', async () => {
		notesStore.notes = [note()];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		const titleElement = container.querySelector(
			'textarea[placeholder="Title"]'
		) as HTMLTextAreaElement;
		expect(titleElement).not.toBeNull();

		// Enter without Shift -> default prevented to move to body
		const enterEvent = new KeyboardEvent('keydown', {
			key: 'Enter',
			cancelable: true,
			bubbles: true
		});
		titleElement.dispatchEvent(enterEvent);
		expect(enterEvent.defaultPrevented).toBe(true);

		// Shift+Enter -> default not prevented, allows multiline entry
		const shiftEnterEvent = new KeyboardEvent('keydown', {
			key: 'Enter',
			shiftKey: true,
			cancelable: true,
			bubbles: true
		});
		titleElement.dispatchEvent(shiftEnterEvent);
		expect(shiftEnterEvent.defaultPrevented).toBe(false);
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

		await fireEvent.input(titleElement, { target: { value: 'Multiline\nLong\nTitle' } });
		expect(titleElement.style.height).toBe('72px');
	});

	it('renders multiline title with whitespace-pre-wrap in NoteCard', () => {
		const testNote = note({ title: 'Line A\nLine B' });
		const { container } = render(NoteCard, {
			props: { note: testNote, onOpen: () => {} }
		});

		const titleEl = container.querySelector('h3');
		expect(titleEl).not.toBeNull();
		expect(titleEl?.textContent?.trim()).toBe('Line A\nLine B');
		expect(titleEl?.className).toContain('whitespace-pre-wrap');
		expect(titleEl?.className).toContain('break-words');
	});

	it('renders multiline title with whitespace-pre-wrap in KanbanCard', () => {
		const testNote = note({ title: 'Column Title\nSecond Row' });
		const { container } = render(KanbanCard, {
			props: {
				note: testNote,
				sourceColumnId: 'col-1',
				onOpen: () => {},
				onMove: () => {}
			}
		});

		const titleEl = container.querySelector('h3');
		expect(titleEl).not.toBeNull();
		expect(titleEl?.textContent?.trim()).toBe('Column Title\nSecond Row');
		expect(titleEl?.className).toContain('whitespace-pre-wrap');
		expect(titleEl?.className).toContain('break-words');
	});
});
