import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { actionUndo } from '#lib/stores/actionUndo.svelte.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { selectionStore } from '#lib/stores/selection.svelte.js';
import { uiStore } from '#lib/stores/ui.svelte.js';
import NotesHomeView from './views/NotesHomeView.svelte';
import Topbar from './Topbar.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('#lib/editorContext.js', () => ({
	useEditorActions: () => ({ startNewNote: vi.fn(), openNote: vi.fn(), closeNote: vi.fn() })
}));

/** A note whose id is its title, so the checks and the store read alike. */
function note(title: string, partial: Partial<Note> = {}): Note {
	return {
		id: title,
		title,
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

const byId = (id: string) => notesStore.notes.find((item) => item.id === id)!;
const bar = () => screen.queryByRole('toolbar', { name: 'Selected notes' });
const check = (title: string) => screen.getByRole('checkbox', { name: `Select ${title}` });
const offered = () =>
	within(bar()!)
		.getAllByRole('button')
		.map((button) => button.getAttribute('aria-label'));

afterEach(() => {
	selectionStore.clear();
	notesStore.notes = [];
	uiStore.setView('notes');
	actionUndo.clear();
});

/** "tram" searched across Notes and Archive, with the top bar and the feed on screen. */
async function searchNotesAndArchive() {
	notesStore.notes = [
		note('Active tram'),
		note('Old tram', { archived: true }),
		note('Quiet', { body: 'nothing' })
	];
	uiStore.setView('notes', null, 'tram');
	uiStore.searchArchiveToo = true;
	render(Topbar);
	render(NotesHomeView);
	await screen.findByRole('heading', { name: 'In Archive' });
}

describe('picking search results in Notes and Archive', () => {
	it('keeps an archived match picked, and offers what its own menu does', async () => {
		await searchNotesAndArchive();

		await fireEvent.click(check('Old tram'));
		await waitFor(() => expect(bar()).not.toBeNull());
		// Settled: the bar does not drop the archived pick as out of place.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(selectionStore.ids).toEqual(['Old tram']);
		expect(check('Old tram').getAttribute('aria-checked')).toBe('true');
		expect(offered()).toEqual(['Clear selection', 'Restore', 'Move to trash']);

		await fireEvent.click(within(bar()!).getByRole('button', { name: 'Restore' }));
		expect(byId('Old tram').archived).toBe(false);
	});

	it('offers only Move to trash for a mix of active and archived matches', async () => {
		await searchNotesAndArchive();

		await fireEvent.click(check('Active tram'));
		await fireEvent.click(check('Old tram'));
		await waitFor(() => expect(within(bar()!).getByText('2 selected')).toBeTruthy());
		expect(offered()).toEqual(['Clear selection', 'Move to trash']);

		await fireEvent.click(within(bar()!).getByRole('button', { name: 'Move to trash' }));
		expect(byId('Active tram').trashed).toBe(true);
		expect(byId('Old tram').trashed).toBe(true);
		expect(actionUndo.bar).toBe('2 notes moved to trash');
		await waitFor(() => expect(bar()).toBeNull());
	});

	it('offers the full set again once only active matches are picked', async () => {
		await searchNotesAndArchive();

		await fireEvent.click(check('Old tram'));
		await fireEvent.click(check('Active tram'));
		await fireEvent.click(check('Old tram'));
		await waitFor(() => expect(within(bar()!).getByText('1 selected')).toBeTruthy());
		expect(offered()).toEqual([
			'Clear selection',
			'Pin to top',
			'Remind me…',
			'Labels',
			'Colour',
			'Archive',
			'Move to trash'
		]);
	});

	it('lets an archived pick go once the search stops reaching into the archive', async () => {
		await searchNotesAndArchive();

		await fireEvent.click(check('Old tram'));
		await waitFor(() => expect(bar()).not.toBeNull());
		uiStore.searchArchiveToo = false;
		await waitFor(() => expect(bar()).toBeNull());
		expect(selectionStore.active).toBe(false);
	});
});
