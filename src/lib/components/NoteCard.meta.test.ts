import { render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { Note } from '$lib/types';
import { notesStore } from '$lib/stores/notes.svelte';
import NoteCard from './NoteCard.svelte';

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'Trip',
		body: 'Pack socks',
		color: 'default',
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

function metaTime(): HTMLElement | null {
	return document.querySelector('[data-note-meta] time');
}

afterEach(() => {
	notesStore.notes = [];
	notesStore.labels = [];
});

describe('NoteCard created/updated meta', () => {
	it('shows Created for a never-edited note', () => {
		const at = new Date(2026, 8, 15, 14, 30).getTime();
		render(NoteCard, { props: { note: note({ createdAt: at, updatedAt: at }), onOpen: () => {} } });

		const time = metaTime();
		expect(time?.textContent).toMatch(/^Created /);
		expect(time?.getAttribute('datetime')).toBe(new Date(at).toISOString());
		expect(time?.getAttribute('title')).toMatch(/^Created /);
	});

	it('shows Edited once the note has been modified', () => {
		const created = new Date(2026, 8, 15, 10, 0).getTime();
		const updated = new Date(2026, 8, 15, 14, 28).getTime();
		render(NoteCard, {
			props: { note: note({ createdAt: created, updatedAt: updated }), onOpen: () => {} }
		});

		const time = metaTime();
		expect(time?.textContent).toMatch(/^Edited /);
		expect(time?.getAttribute('title')).toMatch(/ · Edited /);
	});

	it('shows Deleted from trashedAt for a trashed note', () => {
		const trashedAt = new Date(2026, 8, 15, 12, 30).getTime();
		notesStore.notes = [note({ trashed: true, trashedAt, updatedAt: Math.max(trashedAt, 1) })];
		render(NoteCard, {
			props: {
				note: note({ trashed: true, trashedAt, updatedAt: Math.max(trashedAt, 1) }),
				onOpen: () => {}
			}
		});

		const time = metaTime();
		expect(time?.textContent).toMatch(/^Deleted /);
		expect(time?.getAttribute('datetime')).toBe(new Date(trashedAt).toISOString());
		expect(screen.getByRole('button', { name: /Open Trip/ })).toBeTruthy();
	});
});
