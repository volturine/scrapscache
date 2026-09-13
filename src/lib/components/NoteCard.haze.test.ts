import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '$lib/types';
import { notesStore } from '$lib/stores/notes.svelte';
import NoteCard from './NoteCard.svelte';

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'Trip',
		body: 'packing list',
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

function card(): HTMLElement {
	const found = screen.getByRole('button', { name: 'Open Trip' });
	return found as HTMLElement;
}

function haze(): HTMLElement {
	const found = document.querySelector('[data-card-haze]');
	if (!found) throw new Error('no haze overlay');
	return found as HTMLElement;
}

describe('NoteCard right-click haze', () => {
	beforeEach(() => {
		notesStore.notes = [note()];
		notesStore.labels = [];
	});

	afterEach(() => {
		notesStore.notes = [];
		vi.restoreAllMocks();
	});

	it('shows quick actions over a haze when the card is right-clicked', async () => {
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });

		await fireEvent.contextMenu(card());

		expect(haze()).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Archive note' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Copy note' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Pin note' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Add reminder' })).toBeTruthy();
	});

	it("closes one card's haze when another card is right-clicked", async () => {
		notesStore.notes = [note(), note({ id: 'note-2', title: 'Other' })];
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });
		render(NoteCard, { props: { note: note({ id: 'note-2', title: 'Other' }), onOpen: vi.fn() } });

		await fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Trip' }));
		expect(haze()).toBeTruthy();

		await fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Other' }));
		await waitFor(() => {
			expect(document.querySelectorAll('[data-card-haze]').length).toBe(1);
		});
	});

	it('dismisses the haze with Escape without opening the note', async () => {
		const onOpen = vi.fn();
		render(NoteCard, { props: { note: note(), onOpen } });

		await fireEvent.contextMenu(card());
		await fireEvent.keyDown(document.body, { key: 'Escape' });

		expect(document.querySelector('[data-card-haze]')).toBeNull();
		expect(onOpen).not.toHaveBeenCalled();
	});

	it('closes the haze on an outside press without opening the note', async () => {
		const onOpen = vi.fn();
		render(NoteCard, { props: { note: note(), onOpen } });

		await fireEvent.contextMenu(card());
		await fireEvent.pointerDown(document.body, { pointerId: 1, pointerType: 'mouse' });

		expect(document.querySelector('[data-card-haze]')).toBeNull();
		expect(onOpen).not.toHaveBeenCalled();
	});

	it('trashes the note from the haze delete button', async () => {
		const trash = vi.spyOn(notesStore, 'trashNote').mockImplementation(() => {});
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });

		await fireEvent.contextMenu(card());
		await fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));

		expect(trash).toHaveBeenCalledWith('note-1');
		expect(document.querySelector('[data-card-haze]')).toBeNull();
	});

	it('pins the note from the haze pin button', async () => {
		const togglePin = vi.spyOn(notesStore, 'togglePin').mockImplementation(() => {});
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });

		await fireEvent.contextMenu(card());
		await fireEvent.click(screen.getByRole('button', { name: 'Pin note' }));

		expect(togglePin).toHaveBeenCalledWith('note-1');
		expect(document.querySelector('[data-card-haze]')).toBeNull();
	});

	it('archives the note from the haze archive button', async () => {
		const toggleArchive = vi.spyOn(notesStore, 'toggleArchive').mockImplementation(() => {});
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });

		await fireEvent.contextMenu(card());
		await fireEvent.click(screen.getByRole('button', { name: 'Archive note' }));

		expect(toggleArchive).toHaveBeenCalledWith('note-1');
		expect(document.querySelector('[data-card-haze]')).toBeNull();
	});

	it('copies the note text to the clipboard from the haze', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.assign(navigator, { clipboard: { writeText } });
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });

		await fireEvent.contextMenu(card());
		await fireEvent.click(screen.getByRole('button', { name: 'Copy note' }));

		expect(writeText).toHaveBeenCalledWith('# Trip\npacking list');
		// Feedback is the green checkmark on the copy button; no separate toast.
		expect(screen.getByRole('button', { name: 'Copied to clipboard' })).toBeTruthy();
		expect(screen.queryByRole('status')).toBeNull();
	});

	it('left-click on a hazy card dismisses the haze instead of opening the note', async () => {
		const onOpen = vi.fn();
		render(NoteCard, { props: { note: note(), onOpen } });

		await fireEvent.contextMenu(card());
		await fireEvent.click(card());

		expect(document.querySelector('[data-card-haze]')).toBeNull();
		expect(onOpen).not.toHaveBeenCalled();
	});

	it('restores the note from the haze restore button when trashed', async () => {
		const restoreSpy = vi.spyOn(notesStore, 'restoreNote').mockImplementation(() => {});
		render(NoteCard, { props: { note: note({ trashed: true }), onOpen: vi.fn() } });

		await fireEvent.contextMenu(card());
		const restoreBtn = screen.getByRole('button', { name: 'Restore note' });
		expect(restoreBtn).toBeTruthy();
		expect(restoreBtn.getAttribute('title')).toBe('Restore');
		await fireEvent.click(restoreBtn);

		expect(restoreSpy).toHaveBeenCalledWith('note-1');
		expect(document.querySelector('[data-card-haze]')).toBeNull();
	});

	it('restores the note from the haze restore button when archived', async () => {
		const archiveSpy = vi.spyOn(notesStore, 'toggleArchive').mockImplementation(() => {});
		render(NoteCard, { props: { note: note({ archived: true }), onOpen: vi.fn() } });

		await fireEvent.contextMenu(card());
		const restoreBtn = screen.getByRole('button', { name: 'Restore note' });
		expect(restoreBtn).toBeTruthy();
		expect(restoreBtn.getAttribute('title')).toBe('Restore');
		await fireEvent.click(restoreBtn);

		expect(archiveSpy).toHaveBeenCalledWith('note-1');
		expect(document.querySelector('[data-card-haze]')).toBeNull();
	});

	it('renders hazy with secret overlay for a secret note in gallery view', () => {
		render(NoteCard, { props: { note: note({ secret: true }), onOpen: vi.fn() } });
		expect(document.querySelector('[data-secret-overlay]')).toBeTruthy();
		expect(document.querySelector('.blur-sm')).toBeTruthy();
	});
});
