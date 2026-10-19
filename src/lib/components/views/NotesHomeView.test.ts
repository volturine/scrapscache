import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uiStore } from '#lib/stores/ui.svelte.js';
import NotesHomeView from './NotesHomeView.svelte';

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
		navigation.goto.mockClear();
	});

	it('renders CTA above the fold on empty state and triggers startNewNote', async () => {
		render(NotesHomeView);

		const cta = screen.getByRole('button', { name: 'Take a note' });
		expect(cta).toBeTruthy();

		await fireEvent.click(cta);
		expect(startNewNote).toHaveBeenCalledTimes(1);
	});

	it('names a query that matched nothing and offers to look in Archive or Trash', async () => {
		uiStore.setView('notes', null, 'retro');
		render(NotesHomeView);

		expect(screen.getByText('No notes match “retro”')).toBeTruthy();
		expect(screen.getByText('Archived and deleted notes are not searched here.')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Look in Trash' })).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Look in Archive' }));

		expect(navigation.goto).toHaveBeenCalledWith('/archive');
		expect(uiStore.view).toBe('archive');
		// The query goes along, so Archive shows its match straight away.
		expect(uiStore.searchInput).toBe('retro');
		expect(uiStore.search).toBe('retro');
	});
});
