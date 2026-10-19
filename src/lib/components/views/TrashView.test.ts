import { render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import TrashView from './TrashView.svelte';

const openNote = vi.fn();

vi.mock('#lib/editorContext.js', () => ({
	useEditorActions: () => ({
		openNote,
		closeNote: vi.fn()
	})
}));

function trashedNote(): Note {
	const at = new Date(2026, 9, 10, 10, 0).getTime();
	return {
		id: 'note-1',
		title: 'Trip',
		body: 'Pack socks',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: true,
		trashedAt: at,
		createdAt: at,
		updatedAt: at,
		reminder: null,
		labels: []
	};
}

afterEach(() => {
	notesStore.notes = [];
	notesStore.labels = [];
});

describe('TrashView', () => {
	it('states the purge rule and names the empty action', () => {
		notesStore.notes = [trashedNote()];
		render(TrashView);

		expect(screen.getByText('Notes are deleted forever after 7 days.')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Empty trash' })).toBeTruthy();
	});
});
