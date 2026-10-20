import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { kanbanDrag } from '#lib/kanbanDrag.svelte.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
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
	return screen.getByRole('button', { name: 'Open Ship it' }).closest('article')!;
}

function menu(): HTMLElement | null {
	return document.querySelector('[data-note-actions]');
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

describe('KanbanCard actions menu', () => {
	it('shows the menu from the … button and from a right-click', async () => {
		const shown = card();

		await fireEvent.click(within(shown).getByRole('button', { name: 'Note actions' }));
		await waitFor(() => expect(menu()).not.toBeNull());
		expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeTruthy();
		expect(screen.getByRole('menuitem', { name: 'Add label…' })).toBeTruthy();

		await fireEvent.keyDown(menu()!, { key: 'Escape' });
		await waitFor(() => expect(menu()).toBeNull());

		const allowed = await fireEvent.contextMenu(shown);
		expect(allowed).toBe(false);
		await waitFor(() => expect(menu()).not.toBeNull());
	});

	it('runs an action without opening the note or starting a drag', async () => {
		const onOpen = vi.fn();
		const trash = vi.spyOn(notesStore, 'trashNote').mockImplementation(() => {});
		const shown = card(onOpen);

		await fireEvent.contextMenu(shown);
		await waitFor(() => expect(menu()).not.toBeNull());
		const remove = screen.getByRole('menuitem', { name: 'Move to trash' });
		await fireEvent.pointerDown(remove, { pointerId: 1, pointerType: 'mouse', button: 0 });
		await fireEvent.click(remove);

		expect(trash).toHaveBeenCalledWith('note-1');
		expect(onOpen).not.toHaveBeenCalled();
		expect(kanbanDrag.noteId).toBeNull();
		await waitFor(() => expect(menu()).toBeNull());
	});

	it('does not open the note from a press on the … button', async () => {
		const onOpen = vi.fn();
		const shown = card(onOpen);
		const trigger = within(shown).getByRole('button', { name: 'Note actions' });

		const down = new Event('pointerdown', { bubbles: true, cancelable: true });
		Object.assign(down, { pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 0 });
		await fireEvent(trigger, down);
		await fireEvent.click(trigger);

		expect(onOpen).not.toHaveBeenCalled();
		expect(kanbanDrag.noteId).toBeNull();
	});

	it('swallows the tap that dismisses the menu over another card', async () => {
		const onOpenOther = vi.fn();
		notesStore.notes = [note(), note({ id: 'note-2', title: 'Other' })];
		const shown = card();
		render(KanbanCard, {
			props: {
				note: note({ id: 'note-2', title: 'Other' }),
				columnId: 'todo',
				index: 1,
				onOpen: onOpenOther,
				onDrop: vi.fn()
			}
		});
		const other = screen.getByRole('button', { name: 'Open Other' }).closest('article')!;
		const tap = async () => {
			const down = new Event('pointerdown', { bubbles: true, cancelable: true });
			Object.assign(down, { pointerType: 'touch', pointerId: 1, button: 0 });
			await fireEvent(other, down);
			await fireEvent.click(other);
		};

		await fireEvent.contextMenu(shown);
		await waitFor(() => expect(menu()).not.toBeNull());
		await tap();
		await waitFor(() => expect(menu()).toBeNull());
		expect(onOpenOther).not.toHaveBeenCalled();

		await tap();
		expect(onOpenOther).toHaveBeenCalledWith('note-2');
	});

	it('does not start a hold on the card under the dismissing tap', async () => {
		vi.useFakeTimers();
		try {
			notesStore.notes = [note(), note({ id: 'note-2', title: 'Other' })];
			const shown = card();
			render(KanbanCard, {
				props: {
					note: note({ id: 'note-2', title: 'Other' }),
					columnId: 'todo',
					index: 1,
					onOpen: vi.fn(),
					onDrop: vi.fn()
				}
			});
			const other = screen.getByRole('button', { name: 'Open Other' }).closest('article')!;

			await fireEvent.contextMenu(shown);
			await vi.advanceTimersByTimeAsync(0);
			expect(menu()).not.toBeNull();
			const down = new Event('pointerdown', { bubbles: true, cancelable: true });
			Object.assign(down, {
				pointerType: 'touch',
				pointerId: 1,
				isPrimary: true,
				button: 0,
				clientX: 10,
				clientY: 10
			});
			await fireEvent(other, down);

			// Held past HOLD_MS, a touch press lifts the card for a drag.
			await vi.advanceTimersByTimeAsync(300);
			expect(kanbanDrag.noteId).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});
