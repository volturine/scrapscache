import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { uiStore } from '#lib/stores/ui.svelte.js';
import NotesHomeView from './NotesHomeView.svelte';

function note(id: string, partial: Partial<Note> = {}): Note {
	return {
		id,
		title: id,
		body: '',
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

const startNewNote = vi.fn();
const openNote = vi.fn();
const navigation = vi.hoisted(() => ({ goto: vi.fn(async () => {}) }));

vi.mock('$app/navigation', () => navigation);

vi.mock('#lib/editorContext.js', () => ({
	useEditorActions: () => ({
		startNewNote,
		openNote,
		closeNote: vi.fn()
	})
}));

describe('NotesHomeView', () => {
	afterEach(() => {
		uiStore.setView('notes');
		notesStore.notes = [];
		navigation.goto.mockClear();
	});

	it('renders CTA above the fold on empty state and triggers startNewNote', async () => {
		render(NotesHomeView);

		const cta = screen.getByRole('button', { name: 'Take a note' });
		expect(cta).toBeTruthy();

		await fireEvent.click(cta);
		expect(startNewNote).toHaveBeenCalledTimes(1);
	});

	it('names a query that matched nothing and offers only the places that match', async () => {
		notesStore.notes = [note('archived', { body: 'retro', archived: true })];
		uiStore.setView('notes', null, 'retro');
		render(NotesHomeView);

		expect(screen.getByText('No notes match “retro”')).toBeTruthy();
		expect(screen.getByText('Archived and deleted notes are not searched here.')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Look in Archive' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Look in Trash' })).toBeNull();
	});

	it('says so, with nothing to follow, when no place matches', () => {
		uiStore.setView('notes', null, 'retro');
		render(NotesHomeView);

		expect(screen.getByText('Archive and Trash have no matches either.')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Look in/ })).toBeNull();
	});

	it('carries the query into Trash at once', async () => {
		notesStore.notes = [note('trashed', { body: 'retro', trashed: true, trashedAt: 1 })];
		uiStore.setView('notes', null, 'retro');
		render(NotesHomeView);

		await fireEvent.click(screen.getByRole('button', { name: 'Look in Trash' }));

		expect(navigation.goto).toHaveBeenCalledWith('/trash');
		expect(uiStore.view).toBe('trash');
		// Committed straight away, so Trash never shows its unfiltered list first.
		expect(uiStore.searchInput).toBe('retro');
		expect(uiStore.search).toBe('retro');
	});
});
