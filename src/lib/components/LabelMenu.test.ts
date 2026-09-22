import { render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { Note } from '$lib/types';
import { notesStore } from '$lib/stores/notes.svelte';
import LabelMenu from './LabelMenu.svelte';

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

afterEach(() => {
	notesStore.notes = [];
	notesStore.labels = [];
});

describe('LabelMenu ordering', () => {
	it('lists labels on the note before the rest', () => {
		notesStore.labels = [
			{ id: 'label-a', name: 'alpha', createdAt: 1, updatedAt: 1 },
			{ id: 'label-b', name: 'beta', createdAt: 1, updatedAt: 1 },
			{ id: 'label-c', name: 'gamma', createdAt: 1, updatedAt: 1 }
		];
		notesStore.notes = [note({ labels: ['label-c'] })];

		render(LabelMenu, { props: { noteId: 'note-1', onClose: () => {} } });

		const names = [...document.querySelectorAll('label')].map(
			(row) => row.textContent?.trim() ?? ''
		);
		expect(names).toEqual(['gamma', 'alpha', 'beta']);
	});
});
