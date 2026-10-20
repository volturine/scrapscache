import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Note } from '#lib/types.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import NoteCard from './NoteCard.svelte';
import { noteActionsStyles } from '$panda/styles';

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

/** The card itself: the article around the open control and the actions. */
function card(): HTMLElement {
	// A trashed card's control also names its countdown ("Open Trip, deletes today").
	const found = screen.getByRole('button', { name: /^Open Trip(,|$)/ }).closest('article');
	if (!found) throw new Error('no card');
	return found;
}

/** A press as a finger or mouse makes it; jsdom drops pointerType from the event init. */
async function press(target: Element, pointerType: 'touch' | 'mouse') {
	const event = new Event('pointerdown', { bubbles: true, cancelable: true });
	Object.assign(event, { pointerType, pointerId: 1, button: 0, clientX: 10, clientY: 10 });
	await fireEvent(target, event);
}

/** The end of a press: the finger lifted, or the browser took the press for a scroll. */
async function release(target: Element, type: 'pointerup' | 'pointercancel', pointerId = 1) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.assign(event, { pointerType: 'touch', pointerId });
	await fireEvent(target, event);
}

function menu(): HTMLElement | null {
	return document.querySelector('[data-note-actions]');
}

async function openMenu(from: HTMLElement = card()) {
	await fireEvent.click(within(from).getByRole('button', { name: 'Note actions' }));
	await waitFor(() => expect(menu()).not.toBeNull());
	return menu()!;
}

/** Pick a menu item the way a mouse does: Ark acts on the click that ends a press. */
async function choose(name: string) {
	const item = screen.getByRole('menuitem', { name });
	await fireEvent.pointerDown(item, { pointerType: 'mouse' });
	await fireEvent.click(item);
}

describe('NoteCard actions menu', () => {
	beforeEach(() => {
		notesStore.notes = [note()];
		notesStore.labels = [];
	});

	afterEach(() => {
		notesStore.notes = [];
		vi.restoreAllMocks();
	});

	it('offers every action behind a visible … button, with the preview readable', async () => {
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });
		const trigger = within(card()).getByRole('button', { name: 'Note actions' });
		expect(trigger).toBeTruthy();
		// Nothing covers or blurs the preview while the menu is open.
		await openMenu();
		expect(document.querySelector('[data-secret-content]')).toBeNull();
		expect(document.querySelector('[data-card-haze]')).toBeNull();

		const names = screen.getAllByRole('menuitem').map((item) => item.textContent?.trim());
		expect(names).toEqual([
			'Pin to top',
			'Remind me…',
			'Add label…',
			'Copy as text',
			'Archive',
			'Move to trash'
		]);
		// Colours sit inline, as a group of radio items with the note's colour chosen.
		const swatches = screen.getAllByRole('menuitemradio');
		expect(swatches).toHaveLength(12);
		expect(
			screen.getByRole('menuitemradio', { name: 'Default' }).getAttribute('aria-checked')
		).toBe('true');
	});

	it('hands pointer hits through its app-wide frame, which stays closed to them', async () => {
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });
		const content = await openMenu();
		const positioner = content.parentElement!;
		const frame = positioner.parentElement!;
		// The frame spans the app overlay, whose `> *` rule turns pointer events back on,
		// so only an inline style keeps a click elsewhere landing on the card under it.
		expect(frame.className).toBe(noteActionsStyles.portal);
		expect(frame.style.pointerEvents).toBe('none');
		expect(positioner.className).toBe(noteActionsStyles.positioner);
	});

	it('keeps the title and a reminder out from under the … button', () => {
		render(NoteCard, {
			props: { note: note({ reminder: Date.now() + 3_600_000 }), onOpen: vi.fn() }
		});
		const strip = card().querySelector('[aria-label^="Reminder, "]')!;
		expect(strip.classList.contains(noteActionsStyles.topRoom)).toBe(true);
		expect(within(card()).getByText('Trip').classList.contains(noteActionsStyles.topRoom)).toBe(
			true
		);
	});

	it('opens the note from its open control (Enter and Space click a button)', async () => {
		const onOpen = vi.fn();
		render(NoteCard, { props: { note: note(), onOpen } });

		await fireEvent.click(screen.getByRole('button', { name: 'Open Trip' }));

		expect(onOpen).toHaveBeenCalledWith('note-1');
	});

	it('opens the same menu from a right-click, without opening the note', async () => {
		const onOpen = vi.fn();
		render(NoteCard, { props: { note: note(), onOpen } });

		await fireEvent.contextMenu(card());

		await waitFor(() => expect(menu()).not.toBeNull());
		expect(screen.getByRole('menuitem', { name: 'Move to trash' })).toBeTruthy();
		expect(onOpen).not.toHaveBeenCalled();
	});

	it("closes one card's menu when another card is pressed and right-clicked", async () => {
		const second = note({ id: 'note-2', title: 'Other' });
		notesStore.notes = [note(), second];
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });
		render(NoteCard, { props: { note: second, onOpen: vi.fn() } });
		const other = screen.getByRole('button', { name: 'Open Other' }).closest('article')!;

		await fireEvent.contextMenu(card());
		await waitFor(() => expect(document.querySelectorAll('[data-note-actions]')).toHaveLength(1));
		await press(other, 'mouse');
		await fireEvent.contextMenu(other);

		await waitFor(() => expect(document.querySelectorAll('[data-note-actions]')).toHaveLength(1));
		// The one left open belongs to the card that was right-clicked last.
		expect(
			within(other).getByRole('button', { name: 'Note actions' }).getAttribute('aria-expanded')
		).toBe('true');
		expect(
			within(card()).getByRole('button', { name: 'Note actions' }).getAttribute('aria-expanded')
		).toBe('false');
	});

	it('closes on an outside press without opening the note', async () => {
		const onOpen = vi.fn();
		render(NoteCard, { props: { note: note(), onOpen } });

		await fireEvent.contextMenu(card());
		await waitFor(() => expect(menu()).not.toBeNull());
		await press(document.body, 'mouse');

		await waitFor(() => expect(menu()).toBeNull());
		expect(onOpen).not.toHaveBeenCalled();
	});

	describe('a press on another card while the menu is open', () => {
		let onOpenOther: Mock<(id: string) => void>;
		let other: HTMLElement;

		beforeEach(async () => {
			onOpenOther = vi.fn<(id: string) => void>();
			const second = note({ id: 'note-2', title: 'Other' });
			notesStore.notes = [note(), second];
			render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });
			render(NoteCard, { props: { note: second, onOpen: onOpenOther } });
			other = screen.getByRole('button', { name: 'Open Other' }).closest('article')!;
			await fireEvent.contextMenu(card());
			await waitFor(() => expect(menu()).not.toBeNull());
		});

		it('only dismisses the menu when it is a tap', async () => {
			await press(other, 'touch');
			await release(other, 'pointerup');
			await fireEvent.click(other);

			await waitFor(() => expect(menu()).toBeNull());
			expect(onOpenOther).not.toHaveBeenCalled();

			// Only the dismissing tap: the next one opens the card.
			await press(other, 'touch');
			await release(other, 'pointerup');
			await fireEvent.click(other);
			expect(onOpenOther).toHaveBeenCalledWith('note-2');
		});

		it('does not hold a later tap when the dismissing one never clicked', async () => {
			await press(other, 'touch');

			await press(other, 'touch');
			await fireEvent.click(other);
			expect(onOpenOther).toHaveBeenCalledWith('note-2');
		});

		it('lets a click with no press of its own through once the dismissing press is cancelled', async () => {
			await press(other, 'touch');
			await release(other, 'pointercancel');

			await fireEvent.click(other);
			expect(onOpenOther).toHaveBeenCalledWith('note-2');
		});

		it('still clicks through for a mouse', async () => {
			await press(other, 'mouse');
			await fireEvent.click(other);

			await waitFor(() => expect(menu()).toBeNull());
			expect(onOpenOther).toHaveBeenCalledWith('note-2');
		});
	});

	it('moves the note to the trash', async () => {
		const trash = vi.spyOn(notesStore, 'trashNote').mockImplementation(() => {});
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });

		await openMenu();
		await choose('Move to trash');

		expect(trash).toHaveBeenCalledWith('note-1');
		await waitFor(() => expect(menu()).toBeNull());
	});

	it('pins the note, and offers Unpin once it is pinned', async () => {
		const pin = vi.spyOn(notesStore, 'togglePin').mockImplementation(() => {});
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });
		await openMenu();
		await choose('Pin to top');
		expect(pin).toHaveBeenCalledWith('note-1');

		notesStore.notes = [note({ pinned: true })];
		render(NoteCard, {
			props: { note: note({ id: 'note-3', title: 'Pinned', pinned: true }), onOpen: vi.fn() }
		});
		const pinned = screen.getByRole('button', { name: 'Open Pinned' }).closest('article')!;
		await openMenu(pinned);
		expect(screen.getByRole('menuitem', { name: 'Unpin' })).toBeTruthy();
	});

	it('archives the note', async () => {
		const archive = vi.spyOn(notesStore, 'toggleArchive').mockImplementation(() => {});
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });

		await openMenu();
		await choose('Archive');

		expect(archive).toHaveBeenCalledWith('note-1');
	});

	it('copies the note text to the clipboard', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.assign(navigator, { clipboard: { writeText } });
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });

		await openMenu();
		await choose('Copy as text');

		await waitFor(() => expect(writeText).toHaveBeenCalledWith('# Trip\npacking list'));
		await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Copied' })).toBeTruthy());
	});

	it('changes the colour from the swatches without closing the menu', async () => {
		const update = vi.spyOn(notesStore, 'updateNote').mockImplementation(() => {});
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });

		await openMenu();
		const green = screen.getByRole('menuitemradio', { name: 'Green' });
		await fireEvent.pointerDown(green, { pointerType: 'mouse' });
		await fireEvent.click(green);

		expect(update).toHaveBeenCalledWith('note-1', { color: 'green' });
		expect(menu()).not.toBeNull();
	});

	it('opens the label dialog from Add label…', async () => {
		notesStore.labels = [{ id: 'work', name: 'Work', createdAt: 1, updatedAt: 1 }];
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });

		await openMenu();
		await choose('Add label…');

		await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
		expect(within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'Work' })).toBeTruthy();
	});

	it('shows restore, archive and delete forever for a trashed note', async () => {
		notesStore.notes = [note({ trashed: true, trashedAt: 1 })];
		render(NoteCard, { props: { note: note({ trashed: true, trashedAt: 1 }), onOpen: vi.fn() } });

		await openMenu();

		expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
			'Restore',
			'Archive',
			'Delete forever'
		]);
		expect(screen.queryByRole('menuitemradio')).toBeNull();
	});

	it('shows restore and move to trash for an archived note', async () => {
		notesStore.notes = [note({ archived: true })];
		render(NoteCard, { props: { note: note({ archived: true }), onOpen: vi.fn() } });

		await openMenu();

		expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
			'Restore',
			'Move to trash'
		]);
	});

	it('renders hazy with secret overlay for a secret note while keeping title visible and non-scrollable fixed size', () => {
		render(NoteCard, {
			props: {
				note: note({ secret: true, title: 'Secret Title', body: 'Secret content\n'.repeat(50) }),
				onOpen: vi.fn()
			}
		});
		const overlay = document.querySelector('[data-secret-overlay]');
		expect(overlay).toBeTruthy();
		// The blur says what it is, so it is not taken for a lock.
		expect(overlay?.querySelector('svg')).toBeTruthy();
		expect(overlay?.textContent?.trim()).toBe('Preview hidden');
		const titleEl = screen.getByText('Secret Title');
		expect(titleEl).toBeTruthy();
		expect(titleEl.closest('[data-secret-content]')).toBeNull();
		const blurred = document.querySelector('[data-secret-content]');
		expect(blurred).toBeTruthy();
		expect(blurred?.textContent).toContain('Secret content');
		const secretBody = document.querySelector('[data-secret-body]');
		expect(secretBody).toBeTruthy();
		expect(secretBody?.className).toContain('d_flex');
		expect(secretBody?.className).toContain('flex-d_column');
		// The "…" stays above the blur, so a hidden preview still has its actions.
		expect(screen.getByRole('button', { name: 'Note actions' })).toBeTruthy();
	});
});
