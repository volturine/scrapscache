import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { actionUndo } from '#lib/stores/actionUndo.svelte.js';
import { kanbanStore } from '#lib/stores/kanban.svelte.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { uiStore } from '#lib/stores/ui.svelte.js';
import KanbanView from './KanbanView.svelte';

vi.mock('#lib/editorContext.js', () => ({
	useEditorActions: () => ({ startNewNote: vi.fn(), openNote: vi.fn(), closeNote: vi.fn() })
}));

function note(id: string, labels: string[] = [], partial: Partial<Note> = {}): Note {
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
		labels,
		...partial
	};
}

const desktopMatchMedia = window.matchMedia;

function phone() {
	window.matchMedia = (query: string) => ({
		...desktopMatchMedia(query),
		matches: query === '(max-width: 767px)'
	});
}

let boardId = '';

/** A card in a column, by its title: the article itself has no name of its own. */
function cardNamed(region: HTMLElement, title: string): HTMLElement {
	const found = within(region)
		.getAllByRole('article')
		.find((card) => card.querySelector('h3')?.textContent === title);
	if (!found) throw new Error(`no card ${title}`);
	return found;
}

beforeEach(() => {
	// jsdom has no animations; the card flip asks for them when the list changes.
	Element.prototype.getAnimations = () => [];
	notesStore.labels = [
		{ id: 'todo', name: 'Todo', createdAt: 1, updatedAt: 1 },
		{ id: 'doing', name: 'Doing', createdAt: 1, updatedAt: 1 },
		{ id: 'work', name: 'Work', createdAt: 1, updatedAt: 1 }
	];
	notesStore.notes = [
		note('Plain'),
		note('Worky', ['work']),
		note('Task', ['todo', 'work']),
		note('Busy', ['doing'])
	];
	const board = kanbanStore.createBoard('Sprint');
	boardId = board.id;
	kanbanStore.addTagColumn(boardId, 'todo');
	kanbanStore.addTagColumn(boardId, 'doing');
	kanbanStore.selectBoard(boardId);
});

afterEach(() => {
	window.matchMedia = desktopMatchMedia;
	notesStore.notes = [];
	notesStore.labels = [];
	uiStore.clearSearch();
	actionUndo.clear();
});

/** A column's section: a region on a desktop, the tab's panel on a phone. */
function column(name: string): HTMLElement {
	const pattern = new RegExp(`^${name} (Kanban|label) column$`);
	const found = [...document.querySelectorAll<HTMLElement>('section[aria-label$=" column"]')].find(
		(section) => pattern.test(section.getAttribute('aria-label') ?? '')
	);
	if (!found) throw new Error(`no column ${name}`);
	return found;
}

function cardTitles(region: HTMLElement): string[] {
	return within(region)
		.getAllByRole('article')
		.map((card) => card.querySelector('h3')?.textContent ?? '');
}

/** Open a menu and pick an item the way a mouse does. */
async function pick(
	trigger: HTMLElement,
	item: string,
	role: 'menuitem' | 'menuitemradio' = 'menuitem'
) {
	await fireEvent.click(trigger);
	const option = await screen.findByRole(role, { name: item });
	await fireEvent.pointerDown(option, { pointerType: 'mouse' });
	await fireEvent.click(option);
}

describe('Kanban columns', () => {
	it('calls the first column Unsorted and counts every column', () => {
		render(KanbanView);
		const unsorted = column('Unsorted');
		expect(within(unsorted).getByRole('heading', { level: 2 }).textContent?.trim()).toMatch(
			/^Unsorted\s*2$/
		);
		expect(cardTitles(unsorted)).toEqual(['Plain', 'Worky']);
		expect(within(column('Todo')).getByRole('heading', { level: 2 }).textContent?.trim()).toMatch(
			/^Todo\s*1$/
		);
	});

	it("leaves the column's own label off its cards", () => {
		render(KanbanView);
		const chips = [...column('Todo').querySelectorAll('article span')]
			.map((chip) => chip.textContent?.trim())
			.filter((text) => text === 'Todo' || text === 'Work');
		expect(chips).toEqual(['Work']);
	});

	it('renames the label, moves the column and removes it from its menu', async () => {
		render(KanbanView);
		await pick(screen.getByRole('button', { name: 'Todo column actions' }), 'Rename label…');
		const field = await screen.findByRole('textbox', { name: 'Label name' });
		await fireEvent.input(field, { target: { value: 'Next' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
		await waitFor(() => expect(column('Next')).toBeTruthy());
		expect(notesStore.labelsById.get('todo')?.name).toBe('Next');

		const names = () =>
			screen
				.getAllByRole('region', { name: /column$/ })
				.map((region) => region.getAttribute('aria-label')?.split(' ')[0]);
		await pick(screen.getByRole('button', { name: 'Next column actions' }), 'Move right');
		await waitFor(() => expect(names()).toEqual(['Unsorted', 'Doing', 'Next']));
		// The last label column cannot go further, and none may pass Unsorted.
		await fireEvent.click(screen.getByRole('button', { name: 'Next column actions' }));
		expect(
			(await screen.findByRole('menuitem', { name: 'Move right' })).getAttribute('aria-disabled')
		).toBe('true');
		await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

		await pick(screen.getByRole('button', { name: 'Doing column actions' }), 'Remove column');
		await waitFor(() => expect(names()).toEqual(['Unsorted', 'Next']));
		// The label and its notes stay.
		expect(notesStore.labelsById.get('doing')?.name).toBe('Doing');
		expect(notesStore.notes.find((item) => item.id === 'Busy')?.labels).toEqual(['doing']);
	});

	it('moves a card from its menu, with an undo', async () => {
		render(KanbanView);
		const card = cardNamed(column('Unsorted'), 'Plain');
		await pick(
			within(card).getByRole('button', { name: 'Note actions' }),
			'Doing',
			'menuitemradio'
		);
		await waitFor(() => expect(cardTitles(column('Doing'))).toEqual(['Busy', 'Plain']));
		expect(notesStore.notes.find((item) => item.id === 'Plain')?.labels).toEqual(['doing']);
		expect(actionUndo.bar).toBe('Moved to Doing');
	});
});

describe('the board filter', () => {
	it('is one panel of label chips with Show only or Hide, and counts what is left', async () => {
		render(KanbanView);
		await fireEvent.click(screen.getByRole('button', { name: 'Board filter' }));
		const chips = within(screen.getByRole('group', { name: 'Board filter labels' })).getAllByRole(
			'button'
		);
		// Column labels are never offered: a column already chooses by its own label.
		expect(chips.map((chip) => chip.textContent?.trim())).toEqual(['Work']);
		expect(screen.getByText('4 of 4 notes')).toBeTruthy();

		await fireEvent.click(chips[0]);
		expect(chips[0].getAttribute('aria-pressed')).toBe('true');
		expect(cardTitles(column('Unsorted'))).toEqual(['Worky']);
		expect(cardTitles(column('Todo'))).toEqual(['Task']);
		expect(screen.getByText('2 of 4 notes')).toBeTruthy();

		await fireEvent.click(screen.getByRole('radio', { name: 'Hide' }));
		expect(cardTitles(column('Unsorted'))).toEqual(['Plain']);
		expect(screen.queryAllByRole('region', { name: 'Backlog filter options' })).toHaveLength(0);
	});
});

describe('on a phone', () => {
	beforeEach(phone);

	it("keeps a new board's starter panel and the add-column control on screen, above the column", async () => {
		kanbanStore.selectBoard(kanbanStore.createBoard('Fresh').id);
		render(KanbanView);
		const starter = screen.getByRole('region', { name: 'Boards group your notes by label' });
		const panel = screen.getByRole('tabpanel');
		// Above the one column on screen, not beside it where the track cuts it off.
		expect(starter.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(panel.closest('.kanban-columns')?.contains(starter)).toBe(false);
		// The add-column control shares the tab row.
		const add = screen.getByRole('button', { name: 'Add a label column' });
		expect(add.parentElement?.contains(screen.getByRole('tablist', { name: 'Columns' }))).toBe(
			true
		);
	});

	it('moves between the tabs with the arrows, Home and End, one tab stop, panel linked', async () => {
		render(KanbanView);
		const tabs = within(screen.getByRole('tablist', { name: 'Columns' })).getAllByRole('tab');
		expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
		const panel = screen.getByRole('tabpanel');
		expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id);
		expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id);

		tabs[0].focus();
		await fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
		expect(tabs[1].getAttribute('aria-selected')).toBe('true');
		expect(document.activeElement).toBe(tabs[1]);
		expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
		expect(cardTitles(column('Todo'))).toEqual(['Task']);

		await fireEvent.keyDown(tabs[1], { key: 'End' });
		expect(document.activeElement).toBe(tabs[2]);
		expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[2].id);
		await fireEvent.keyDown(tabs[2], { key: 'ArrowRight' });
		expect(document.activeElement).toBe(tabs[2]);
		await fireEvent.keyDown(tabs[2], { key: 'Home' });
		expect(document.activeElement).toBe(tabs[0]);
		expect(cardTitles(column('Unsorted'))).toEqual(['Plain', 'Worky']);
	});

	it('shows one column at a time, picked by its tab, with a Move to in the card menu', async () => {
		render(KanbanView);
		const tabs = within(screen.getByRole('tablist', { name: 'Columns' })).getAllByRole('tab');
		expect(tabs.map((tab) => tab.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'Unsorted 2',
			'Todo 1',
			'Doing 1'
		]);
		expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
		expect(column('Unsorted')).toBeTruthy();

		await fireEvent.click(tabs[2]);
		expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
		expect(cardTitles(column('Doing'))).toEqual(['Busy']);

		const card = cardNamed(column('Doing'), 'Busy');
		await pick(within(card).getByRole('button', { name: 'Note actions' }), 'Todo', 'menuitemradio');
		// The board follows the card to the column it went to.
		await waitFor(() => expect(cardTitles(column('Todo'))).toEqual(['Task', 'Busy']));
	});
});
