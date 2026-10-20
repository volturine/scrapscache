import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { uiStore } from '#lib/stores/ui.svelte.js';
import NotesHomeView from './views/NotesHomeView.svelte';
import KanbanCardBody from './KanbanCardBody.svelte';

const navigation = vi.hoisted(() => ({ goto: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => navigation);

const startNewNote = vi.fn();
vi.mock('#lib/editorContext.js', () => ({
	useEditorActions: () => ({ startNewNote, openNote: vi.fn(), closeNote: vi.fn() })
}));

function note(id: string, partial: Partial<Note> = {}): Note {
	return {
		id,
		title: id,
		body: 'tram 28',
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
	uiStore.setView('notes');
	startNewNote.mockClear();
});

/** Open a chip's menu and pick an item the way a mouse does. */
async function pick(chip: string | RegExp, item: string) {
	await fireEvent.click(screen.getByRole('button', { name: chip }));
	const option = await screen.findByRole('menuitemradio', { name: item });
	await fireEvent.pointerDown(option, { pointerType: 'mouse' });
	await fireEvent.click(option);
	await waitFor(() => expect(screen.queryByRole('menuitemradio', { name: item })).toBeNull());
}

function cardTitles(): string[] {
	return screen.getAllByRole('article').map((card) => card.querySelector('h3')?.textContent ?? '');
}

describe('the chips under the search field', () => {
	it('appear only with a query, and count what it found', async () => {
		notesStore.notes = [note('Lisbon'), note('Porto'), note('Quiet', { body: 'nothing' })];
		render(NotesHomeView);
		expect(document.querySelector('[data-search-filters]')).toBeNull();

		uiStore.setView('notes', null, 'tram');
		await waitFor(() => expect(document.querySelector('[data-search-filters]')).not.toBeNull());
		expect(document.querySelector('[data-search-count]')?.textContent).toBe('2 notes');
		const chips = within(document.querySelector('[data-search-filters]') as HTMLElement)
			.getAllByRole('button')
			.map((chip) => chip.textContent?.trim());
		expect(chips).toEqual(['In: Notes', 'Label', 'Colour', 'Type']);
	});

	it('narrow by label, colour and type, and clear together', async () => {
		notesStore.labels = [{ id: 'travel', name: 'Travel', createdAt: 1, updatedAt: 1 }];
		notesStore.notes = [
			note('Lisbon', { labels: ['travel'], color: 'blue', body: '[ ] tram 28' }),
			note('Porto', { color: 'blue' }),
			note('Madrid', { labels: ['travel'] })
		];
		uiStore.setView('notes', null, 'tram');
		render(NotesHomeView);

		await pick('Label', 'Travel');
		expect(screen.getByRole('button', { name: 'Label: Travel' })).toBeTruthy();
		expect(cardTitles().sort()).toEqual(['Lisbon', 'Madrid']);

		await pick('Colour', 'Blue');
		expect(cardTitles()).toEqual(['Lisbon']);
		expect(document.querySelector('[data-search-count]')?.textContent).toBe('1 note');

		await pick('Type', 'Checklist');
		expect(cardTitles()).toEqual(['Lisbon']);

		await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
		expect(cardTitles().sort()).toEqual(['Lisbon', 'Madrid', 'Porto']);
		expect(uiStore.searchFilters).toEqual({ label: null, color: null, type: null });
	});

	it('say so when the chips leave nothing, and offer to clear them', async () => {
		notesStore.notes = [note('Lisbon', { color: 'red' })];
		uiStore.setView('notes', null, 'tram');
		render(NotesHomeView);

		await pick('Colour', 'Blue');
		expect(screen.getByText('No notes match “tram” with these filters')).toBeTruthy();
		// The empty state's own next step (after the chip row's in the page).
		await fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' }).at(-1)!);
		expect(cardTitles()).toEqual(['Lisbon']);
	});

	it('list archived matches under the active ones for "Notes and Archive"', async () => {
		notesStore.notes = [note('Lisbon'), note('Old trip', { archived: true })];
		uiStore.setView('notes', null, 'tram');
		render(NotesHomeView);
		expect(cardTitles()).toEqual(['Lisbon']);

		await pick(/^In:/, 'Notes and Archive');
		expect(screen.getByRole('button', { name: 'In: Notes and Archive' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'In Archive' })).toBeTruthy();
		expect(cardTitles()).toEqual(['Lisbon', 'Old trip']);
		expect(document.querySelector('[data-search-count]')?.textContent).toBe('2 notes');
	});

	it('carry the query and the chips to another place', async () => {
		notesStore.notes = [note('Lisbon', { color: 'blue' })];
		uiStore.setView('notes', null, 'tram');
		render(NotesHomeView);
		await pick('Colour', 'Blue');

		await pick(/^In:/, 'Trash');
		expect(navigation.goto).toHaveBeenCalledWith('/trash');
		expect(uiStore.view).toBe('trash');
		expect(uiStore.search).toBe('tram');
		expect(uiStore.searchFilters.color).toBe('blue');
	});

	it('go away with the query, taking the chips with them', async () => {
		notesStore.notes = [note('Lisbon')];
		uiStore.setView('notes', null, 'tram');
		render(NotesHomeView);
		await pick('Type', 'Link');
		expect(screen.getByText('No notes match “tram” with these filters')).toBeTruthy();

		uiStore.clearSearch();
		await waitFor(() => expect(document.querySelector('[data-search-filters]')).toBeNull());
		expect(uiStore.searchFilters).toEqual({ label: null, color: null, type: null });
		expect(cardTitles()).toEqual(['Lisbon']);
	});
});

describe('a search that found nothing', () => {
	it('offers the query as the title of a new note, and clears the search', async () => {
		notesStore.notes = [note('Quiet', { body: 'nothing' })];
		uiStore.setView('notes', null, 'retro');
		render(NotesHomeView);

		await fireEvent.click(screen.getByRole('button', { name: 'Create a note titled “retro”' }));

		expect(startNewNote).toHaveBeenCalledWith({ title: 'retro' });
		expect(uiStore.search).toBe('');
	});
});

describe('why a card matched', () => {
	it('is marked in its title, body and labels', async () => {
		notesStore.labels = [{ id: 'tram', name: 'Trams', createdAt: 1, updatedAt: 1 }];
		notesStore.notes = [
			note('Tram day', { body: 'Tram 28 early, then tram 15', labels: ['tram'] })
		];
		uiStore.setView('notes', null, 'tram');
		render(NotesHomeView);

		const card = screen.getByRole('article');
		const marks = [...card.querySelectorAll('mark')].map((mark) => mark.textContent);
		expect(marks).toEqual(['Tram', 'Tram', 'tram', 'Tram']);
		expect(card.querySelector('h3')?.textContent).toBe('Tram day');
	});

	it('is marked across token boundaries in Markdown and in code', async () => {
		notesStore.notes = [
			note('Code', { body: '```bash\necho"Trip"\n```' }),
			note('Bold', { body: 'see **Tram** 28' })
		];
		uiStore.setView('notes', null, 'o"Tr');
		render(NotesHomeView);
		const code = screen
			.getAllByRole('article')
			.find((card) => card.querySelector('h3')?.textContent === 'Code')!;
		// The tokenizer splits the line into echo and "Trip"; the match spans both.
		expect([...code.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
			'o',
			'"Tr'
		]);

		uiStore.search = '**Tram**';
		await waitFor(() => {
			const bold = screen
				.getAllByRole('article')
				.find((card) => card.querySelector('h3')?.textContent === 'Bold')!;
			expect([...bold.querySelectorAll('mark')].map((mark) => mark.textContent).join('')).toBe(
				'**Tram**'
			);
		});
	});

	it('is marked in a Kanban card found by its label alone', async () => {
		notesStore.labels = [{ id: 'tram', name: 'Trams', createdAt: 1, updatedAt: 1 }];
		notesStore.notes = [note('Lisbon', { body: 'a day out', labels: ['tram'] })];
		uiStore.setView('kanban', null, 'tram');
		const { container } = render(KanbanCardBody, { props: { note: notesStore.notes[0] } });
		expect([...container.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
			'Tram'
		]);
	});

	it('is not marked once the search is cleared', async () => {
		notesStore.notes = [note('Tram day')];
		uiStore.setView('notes', null, 'tram');
		render(NotesHomeView);
		expect(screen.getByRole('article').querySelector('mark')).not.toBeNull();

		uiStore.clearSearch();
		await waitFor(() => expect(screen.getByRole('article').querySelector('mark')).toBeNull());
	});
});
