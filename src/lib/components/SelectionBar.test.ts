import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { actionUndo } from '#lib/stores/actionUndo.svelte.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { selectionStore } from '#lib/stores/selection.svelte.js';
import { uiStore } from '#lib/stores/ui.svelte.js';
import Topbar from './Topbar.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('#lib/editorContext.js', () => ({
	useEditorActions: () => ({ startNewNote: vi.fn(), openNote: vi.fn(), closeNote: vi.fn() })
}));

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

const byId = (id: string) => notesStore.notes.find((item) => item.id === id)!;

afterEach(() => {
	selectionStore.clear();
	notesStore.notes = [];
	notesStore.labels = [];
	uiStore.setView('notes');
	actionUndo.clear();
});

async function pickMenuItem(
	menuName: string,
	item: string,
	role: 'menuitemradio' | 'menuitemcheckbox'
) {
	await fireEvent.click(screen.getByRole('button', { name: menuName }));
	const option = await screen.findByRole(role, { name: item });
	await fireEvent.pointerDown(option, { pointerType: 'mouse' });
	await fireEvent.click(option);
}

describe('the top bar while notes are selected', () => {
	it('becomes an action bar that counts the picked notes and works on all of them', async () => {
		notesStore.notes = [note('a'), note('b'), note('c')];
		render(Topbar);
		expect(screen.queryByRole('toolbar', { name: 'Selected notes' })).toBeNull();

		selectionStore.toggle('a');
		selectionStore.toggle('b');
		const bar = await screen.findByRole('toolbar', { name: 'Selected notes' });
		expect(bar.textContent).toContain('2 selected');
		expect(screen.queryByRole('searchbox')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Pin to top' }));
		expect(byId('a').pinned).toBe(true);
		expect(byId('b').pinned).toBe(true);
		expect(byId('c').pinned).toBe(false);
		// Every picked note is pinned now, so the same control unpins.
		expect(screen.getByRole('button', { name: 'Unpin' })).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
		expect(byId('a').archived).toBe(true);
		expect(byId('b').archived).toBe(true);
		expect(actionUndo.bar).toBe('2 notes archived');
		// The action ends the selection and hands the bar back.
		await waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());
		expect(screen.getByRole('searchbox')).toBeTruthy();
	});

	it('labels and colours the picked notes from its menus', async () => {
		notesStore.labels = [{ id: 'l', name: 'Work', createdAt: 1, updatedAt: 1 }];
		notesStore.notes = [note('a', { labels: ['l'] }), note('b')];
		render(Topbar);
		selectionStore.toggle('a');
		selectionStore.toggle('b');
		await screen.findByRole('toolbar', { name: 'Selected notes' });

		// One note has the label, so it reads as off; picking it puts it on both.
		await pickMenuItem('Labels', 'Work', 'menuitemcheckbox');
		expect(byId('b').labels).toEqual(['l']);

		await pickMenuItem('Colour', 'Blue', 'menuitemradio');
		expect(byId('a').color).toBe('blue');
		expect(byId('b').color).toBe('blue');
	});

	it('restores from the archive, and deletes from the trash only after a second step', async () => {
		notesStore.notes = [note('a', { archived: true }), note('t', { trashed: true, trashedAt: 1 })];
		uiStore.setView('archive');
		render(Topbar);
		selectionStore.toggle('a');
		await screen.findByRole('toolbar', { name: 'Selected notes' });
		expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
		expect(byId('a').archived).toBe(false);

		uiStore.setView('trash');
		selectionStore.toggle('t');
		await screen.findByRole('toolbar', { name: 'Selected notes' });
		await fireEvent.click(screen.getByRole('button', { name: 'Delete forever' }));
		expect(screen.getByText('Delete 1 forever?')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
		expect(byId('t')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete forever' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(notesStore.notes.find((item) => item.id === 't')).toBeUndefined());
	});

	it('lets the selection go on Escape and on the close control', async () => {
		notesStore.notes = [note('a')];
		render(Topbar);
		selectionStore.toggle('a');
		await screen.findByRole('toolbar', { name: 'Selected notes' });
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(selectionStore.active).toBe(false);

		selectionStore.toggle('a');
		await fireEvent.click(await screen.findByRole('button', { name: 'Clear selection' }));
		expect(selectionStore.active).toBe(false);
	});
});
