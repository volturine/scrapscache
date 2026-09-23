import { render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { Note } from '$lib/types';
import { notesStore } from '$lib/stores/notes.svelte';
import { uiStore } from '$lib/stores/ui.svelte';
import NoteEditor from './NoteEditor.svelte';

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'Groceries',
		body: '[ ] Oat milk',
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

function metaTime(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-note-meta] time');
}

afterEach(() => {
	notesStore.notes = [];
	notesStore.labels = [];
	uiStore.rawMarkdown = false;
});

describe('NoteEditor created/updated meta', () => {
	it('shows Created with an ISO datetime for a never-edited note', () => {
		const at = new Date(2026, 8, 15, 14, 30).getTime();
		notesStore.notes = [note({ createdAt: at, updatedAt: at })];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		const time = metaTime(container);
		expect(time?.textContent).toMatch(/^Created /);
		expect(time?.getAttribute('datetime')).toBe(new Date(at).toISOString());
		expect(time?.getAttribute('title')).toMatch(/^Created /);
		expect(time?.getAttribute('title')).not.toMatch(/Edited/);
	});

	it('shows Edited with created and edited absolutes once updatedAt moves', () => {
		const created = new Date(2026, 8, 15, 10, 0).getTime();
		const updated = new Date(2026, 8, 15, 14, 28).getTime();
		notesStore.notes = [note({ createdAt: created, updatedAt: updated })];
		const { container } = render(NoteEditor, {
			props: { noteId: 'note-1', onClose: () => {} }
		});

		const time = metaTime(container);
		expect(time?.textContent).toMatch(/^Edited /);
		expect(time?.getAttribute('datetime')).toBe(new Date(updated).toISOString());
		expect(time?.getAttribute('title')).toMatch(/ · Edited /);
	});
});
