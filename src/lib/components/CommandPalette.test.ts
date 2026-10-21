import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { rememberRecentNote } from '#lib/recentNotes.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { syncStore } from '#lib/stores/sync.svelte.js';
import { uiStore } from '#lib/stores/ui.svelte.js';
import CommandPalette from './CommandPalette.svelte';

const navigation = vi.hoisted(() => ({ goto: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => navigation);

const editor = vi.hoisted(() => ({ openNote: vi.fn(), startNewNote: vi.fn(), closeNote: vi.fn() }));
vi.mock('#lib/editorContext.js', () => ({ useEditorActions: () => editor }));

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

const WORKSPACE = 'palette-test';
let previousWorkspace: string;
const onClose = vi.fn();
const onBackup = vi.fn();

function open() {
	render(CommandPalette, { props: { onClose, onBackup } });
	return screen.getByRole('combobox', { name: 'Search notes, labels and actions' });
}

const options = () => screen.getAllByRole('option');
const text = (element: Element) => element.textContent?.replace(/\s+/g, ' ').trim();
const optionText = () => options().map(text);
const group = (name: string) => screen.getByRole('group', { name });

beforeEach(() => {
	previousWorkspace = syncStore.activeId;
	syncStore.activeId = WORKSPACE;
	uiStore.setView('notes');
	notesStore.labels = [
		{ id: 'travel', name: 'Travel', createdAt: 1, updatedAt: 1 },
		{ id: 'work', name: 'Work', createdAt: 1, updatedAt: 1 }
	];
	notesStore.notes = [
		note('Old tram tickets', { body: 'Lisbon, 2024', trashed: true, trashedAt: 2 }),
		note('Lisbon trip ideas', {
			body: '- [ ] Pastéis de Belém\n- [ ] Tram 28 early',
			color: 'blue'
		}),
		note('Passport', { body: 'Renew before January', labels: ['travel'], archived: true }),
		note('Weekly plan', { body: 'Review the PR queue', labels: ['work', 'travel'] }),
		note('', { id: 'untitled', body: '# Groceries\nOat milk' })
	];
});

afterEach(() => {
	localStorage.clear();
	syncStore.activeId = previousWorkspace;
	notesStore.notes = [];
	notesStore.labels = [];
	uiStore.setTheme('system');
	uiStore.layout = 'grid';
	vi.clearAllMocks();
});

describe('CommandPalette with nothing typed', () => {
	it('lists the notes opened last on this device, then the actions', () => {
		rememberRecentNote(WORKSPACE, 'Weekly plan');
		rememberRecentNote(WORKSPACE, 'gone');
		rememberRecentNote(WORKSPACE, 'Passport');
		open();

		expect(
			within(group('Recent'))
				.getAllByRole('option')
				.map((option) => option.textContent)
		).toHaveLength(2);
		expect(optionText().slice(0, 2)).toEqual([
			expect.stringMatching(/^Passport.*Archived$/),
			expect.stringMatching(/^Weekly plan/)
		]);
		const actions = within(group('Actions'))
			.getAllByRole('option')
			.map((option) => text(option));
		expect(actions).toEqual([
			'New note',
			'Go to Reminders',
			'Go to Kanban',
			'Go to Archive',
			'Go to Trash',
			expect.stringMatching(/^Switch to (light|dark) theme$/),
			'Show notes as a list',
			'Back up notes…',
			'Sync settings'
		]);
	});
});

describe('CommandPalette search', () => {
	it('finds notes in every place, active first, and marks archived and trashed ones', async () => {
		const field = open();
		await fireEvent.input(field, { target: { value: 'tram' } });

		expect(
			within(group('Notes'))
				.getAllByRole('option')
				.map((o) => text(o))
		).toEqual([
			expect.stringMatching(/^Lisbon trip ideas Tram 28 early$/),
			expect.stringMatching(/^Old tram tickets.*In Trash$/)
		]);
		const marks = [...document.querySelectorAll('mark')].map((mark) => mark.textContent);
		expect(marks).toEqual(['Tram', 'tram']);
	});

	it('offers labels with their note count, and the actions that match', async () => {
		const field = open();
		await fireEvent.input(field, { target: { value: 'tr' } });

		expect(within(group('Labels')).getByRole('option').textContent).toContain(
			'Show the note with this label'
		);
		expect(
			within(group('Actions'))
				.getAllByRole('option')
				.map((o) => text(o))
		).toEqual(['Go to Trash']);
		// A note found by its label says which label.
		await fireEvent.input(field, { target: { value: 'travel' } });
		expect(within(group('Notes')).getAllByRole('option')[0].textContent).toContain('Work · Travel');
	});

	it('titles an untitled note by its first line', async () => {
		const field = open();
		await fireEvent.input(field, { target: { value: 'oat' } });
		expect(text(within(group('Notes')).getByRole('option'))).toBe('Groceries Oat milk');
	});

	it('says when nothing matches', async () => {
		const field = open();
		await fireEvent.input(field, { target: { value: 'zzzz' } });
		expect(screen.getByRole('status').textContent).toBe('Nothing matches “zzzz”.');
		expect(screen.queryAllByRole('option')).toHaveLength(0);
	});
});

describe('CommandPalette keyboard and choices', () => {
	it('moves with the arrows, wraps, and opens the note with Enter', async () => {
		const field = open();
		await fireEvent.input(field, { target: { value: 'tram' } });
		const [first, second] = options();
		expect(first.getAttribute('aria-selected')).toBe('true');
		expect(field.getAttribute('aria-activedescendant')).toBe(first.id);

		await fireEvent.keyDown(field, { key: 'ArrowDown' });
		expect(second.getAttribute('aria-selected')).toBe('true');
		expect(field.getAttribute('aria-activedescendant')).toBe(second.id);
		await fireEvent.keyDown(field, { key: 'ArrowDown' });
		await fireEvent.keyDown(field, { key: 'ArrowUp' });
		await fireEvent.keyDown(field, { key: 'ArrowUp' });
		expect(first.getAttribute('aria-selected')).toBe('true');
		await fireEvent.keyDown(field, { key: 'ArrowUp' });
		expect(options().at(-1)!.getAttribute('aria-selected')).toBe('true');

		await fireEvent.keyDown(field, { key: 'ArrowDown' });
		await fireEvent.keyDown(field, { key: 'Enter' });
		expect(onClose).toHaveBeenCalled();
		await waitFor(() => expect(editor.openNote).toHaveBeenCalledWith('Lisbon trip ideas'));
	});

	it("goes to a label's notes", async () => {
		const field = open();
		await fireEvent.input(field, { target: { value: 'work' } });
		await fireEvent.click(within(group('Labels')).getByRole('option'));
		await waitFor(() => expect(navigation.goto).toHaveBeenCalledWith('/label/work'));
		expect(uiStore.view).toBe('label');
		expect(uiStore.activeLabelId).toBe('work');
	});

	it('runs the actions', async () => {
		uiStore.setTheme('light');
		const field = open();
		await fireEvent.input(field, { target: { value: 'theme' } });
		await fireEvent.keyDown(field, { key: 'Enter' });
		await waitFor(() => expect(uiStore.theme).toBe('dark'));

		await fireEvent.input(field, { target: { value: 'back up' } });
		await fireEvent.keyDown(field, { key: 'Enter' });
		await waitFor(() => expect(onBackup).toHaveBeenCalled());

		await fireEvent.input(field, { target: { value: 'new note' } });
		await fireEvent.keyDown(field, { key: 'Enter' });
		await waitFor(() => expect(editor.startNewNote).toHaveBeenCalled());
	});
});
