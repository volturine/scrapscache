import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '$lib/types';
import { kanbanDrag } from '$lib/kanbanDrag.svelte';
import { notesStore } from '$lib/stores/notes.svelte';
import KanbanCard from './KanbanCard.svelte';

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'Ship it',
		body: 'release notes',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		images: [],
		...partial
	};
}

function card(onOpen = vi.fn()) {
	render(KanbanCard, {
		props: { note: note(), columnId: 'todo', index: 0, onOpen, onDrop: vi.fn() }
	});
	return screen.getByRole('button', { name: 'Open Ship it' });
}

beforeEach(() => {
	notesStore.notes = [note()];
	notesStore.labels = [];
});

afterEach(() => {
	kanbanDrag.cancel();
	notesStore.notes = [];
	vi.restoreAllMocks();
});

describe('KanbanCard quick actions', () => {
	it('shows the quick actions when the card is right-clicked', async () => {
		const shown = card();

		const allowed = await fireEvent.contextMenu(shown);

		expect(allowed).toBe(false);
		expect(document.querySelector('[data-card-haze]')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Archive note' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Tag note' })).toBeTruthy();
	});

	it('runs an action without opening the note or starting a drag', async () => {
		const onOpen = vi.fn();
		const trash = vi.spyOn(notesStore, 'trashNote').mockImplementation(() => {});
		const shown = card(onOpen);

		await fireEvent.contextMenu(shown);
		const remove = screen.getByRole('button', { name: 'Delete note' });
		await fireEvent.pointerDown(remove, { pointerId: 1, pointerType: 'mouse', button: 0 });
		await fireEvent.click(remove);

		expect(trash).toHaveBeenCalledWith('note-1');
		expect(onOpen).not.toHaveBeenCalled();
		expect(kanbanDrag.noteId).toBeNull();
		expect(document.querySelector('[data-card-haze]')).toBeNull();
	});

	it('closes on Escape without opening the note', async () => {
		const onOpen = vi.fn();
		const shown = card(onOpen);

		await fireEvent.contextMenu(shown);
		await fireEvent.keyDown(shown, { key: 'Escape' });

		expect(document.querySelector('[data-card-haze]')).toBeNull();
		expect(onOpen).not.toHaveBeenCalled();
	});
});
