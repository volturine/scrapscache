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

	it('shows exactly 3 quick options for a trashed note: restore, archive, and delete forever', async () => {
		const restoreSpy = vi.spyOn(notesStore, 'restoreNote').mockImplementation(() => {});
		const archiveSpy = vi.spyOn(notesStore, 'restoreToArchive').mockImplementation(() => {});
		const deleteSpy = vi.spyOn(notesStore, 'deleteNoteForever').mockImplementation(async () => {});
		render(NoteCard, { props: { note: note({ trashed: true }), onOpen: vi.fn() } });

		await fireEvent.contextMenu(card());
		const haze = document.querySelector('[data-card-haze]')!;
		const buttons = haze.querySelectorAll('button');
		expect(buttons.length).toBe(3);

		const restoreBtn = screen.getByRole('button', { name: 'Restore note' });
		const archiveBtn = screen.getByRole('button', { name: 'Archive note' });
		const deleteBtn = screen.getByRole('button', { name: 'Delete forever' });
		expect(restoreBtn).toBeTruthy();
		expect(archiveBtn).toBeTruthy();
		expect(deleteBtn).toBeTruthy();

		await fireEvent.click(restoreBtn);
		expect(restoreSpy).toHaveBeenCalledWith('note-1');

		await fireEvent.contextMenu(card());
		await fireEvent.click(screen.getByRole('button', { name: 'Archive note' }));
		expect(archiveSpy).toHaveBeenCalledWith('note-1');

		await fireEvent.contextMenu(card());
		await fireEvent.click(screen.getByRole('button', { name: 'Delete forever' }));
		expect(deleteSpy).toHaveBeenCalledWith('note-1');
	});

	it('shows exactly 2 quick options for an archived note: restore and delete', async () => {
		const archiveSpy = vi.spyOn(notesStore, 'toggleArchive').mockImplementation(() => {});
		const deleteSpy = vi.spyOn(notesStore, 'trashNote').mockImplementation(() => {});
		render(NoteCard, { props: { note: note({ archived: true }), onOpen: vi.fn() } });

		await fireEvent.contextMenu(card());
		const haze = document.querySelector('[data-card-haze]')!;
		const buttons = haze.querySelectorAll('button');
		expect(buttons.length).toBe(2);

		const restoreBtn = screen.getByRole('button', { name: 'Restore note' });
		const deleteBtn = screen.getByRole('button', { name: 'Delete note' });
		expect(restoreBtn).toBeTruthy();
		expect(deleteBtn).toBeTruthy();

		await fireEvent.click(restoreBtn);
		expect(archiveSpy).toHaveBeenCalledWith('note-1');

		await fireEvent.contextMenu(card());
		await fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
		expect(deleteSpy).toHaveBeenCalledWith('note-1');
	});

	it('renders hazy with secret overlay for a secret note while keeping title visible and non-scrollable fixed size', () => {
		render(NoteCard, {
			props: {
				note: note({ secret: true, title: 'Secret Title', body: 'Secret content\n'.repeat(50) }),
				onOpen: vi.fn()
			}
		});
		expect(document.querySelector('[data-secret-overlay]')).toBeTruthy();
		const titleEl = screen.getByText('Secret Title');
		expect(titleEl).toBeTruthy();
		expect(titleEl.closest('[data-secret-content]')).toBeNull();
		const blurred = document.querySelector('[data-secret-content]');
		expect(blurred).toBeTruthy();
		expect(blurred?.textContent).toContain('Secret content');

		// Non-scrollable verification with overlay in visible body area
		expect(document.querySelector('.scrollable')).toBeNull();
		const secretBody = document.querySelector('[data-secret-body]');
		expect(secretBody).toBeTruthy();
		// The secret viewport must be a flex column so its content is constrained
		// by the card's max height instead of expanding to the hidden note height.
		expect(secretBody?.className).toContain('d_flex');
		expect(secretBody?.className).toContain('flex-d_column');
		const overlay = document.querySelector('[data-secret-overlay]');
		expect(overlay).toBeTruthy();
		expect(overlay?.querySelector('svg')).toBeTruthy();
		expect(overlay?.textContent).toBe('');
	});

	it('renders trashed notes with the same visual card styling as regular notes', () => {
		const { container: regularContainer } = render(NoteCard, {
			props: { note: note(), onOpen: vi.fn() }
		});
		const regularCard = regularContainer.querySelector('[role="button"]') as HTMLElement;
		const regularContentPad = regularCard.querySelector(
			'.scrapscache-card__contentPad'
		) as HTMLElement;

		const { container: trashedContainer } = render(NoteCard, {
			props: { note: note({ id: 'note-trashed', trashed: true }), onOpen: vi.fn() }
		});
		const trashedCard = trashedContainer.querySelector('[role="button"]') as HTMLElement;
		const trashedContentPad = trashedCard.querySelector(
			'.scrapscache-card__contentPad'
		) as HTMLElement;

		expect(trashedCard.className).toBe(regularCard.className);
		expect(trashedContentPad.className).toBe(regularContentPad.className);
	});
});
