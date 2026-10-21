import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { uiStore } from '#lib/stores/ui.svelte.js';
import Topbar from './Topbar.svelte';

const navigation = vi.hoisted(() => ({ goto: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => navigation);

const closeNote = vi.fn();
vi.mock('#lib/editorContext.js', () => ({
	useEditorActions: () => ({ startNewNote: vi.fn(), openNote: vi.fn(), closeNote })
}));

const desktopMatchMedia = window.matchMedia;

/** A phone: the top bar's own media query matches. */
function phone() {
	window.matchMedia = (query: string) => ({
		...desktopMatchMedia(query),
		matches: query === '(max-width: 767px)'
	});
}

beforeEach(phone);

afterEach(() => {
	window.matchMedia = desktopMatchMedia;
	uiStore.setView('notes');
	uiStore.paletteOpen = false;
	uiStore.labelsOpen = false;
	uiStore.clearSearch();
	uiStore.sidebarOpen = true;
	notesStore.labels = [];
	navigation.goto.mockClear();
});

describe('the top bar on a phone', () => {
	it('names the view and offers sync and More, not the sidebar toggle or the field', () => {
		render(Topbar);
		expect(document.querySelector('[data-view-title]')?.textContent).toBe('Notes');
		expect(screen.queryByRole('button', { name: 'Toggle sidebar' })).toBeNull();
		expect(screen.queryByRole('searchbox')).toBeNull();
		expect(screen.getByRole('button', { name: /^Sync settings/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
	});

	it("names a label's view by the label", () => {
		notesStore.labels = [{ id: 'travel', name: 'Travel', createdAt: 1, updatedAt: 1 }];
		uiStore.setView('label', 'travel');
		render(Topbar);
		expect(document.querySelector('[data-view-title]')?.textContent).toBe('Travel');
	});

	it('drops a query typed on a wide window when the window narrows to a phone', async () => {
		// The phone bar has no field to show it or clear it, so it must not keep filtering.
		window.matchMedia = desktopMatchMedia;
		uiStore.setSearchInput('Groceries');
		uiStore.search = 'Groceries';
		phone();
		render(Topbar);

		await waitFor(() => expect(uiStore.searchInput).toBe(''));
		expect(uiStore.search).toBe('');
		expect(screen.queryByRole('searchbox')).toBeNull();
	});

	it('opens the palette over the whole screen, with a way back', async () => {
		render(Topbar);
		uiStore.paletteOpen = true;
		await screen.findByRole('combobox', { name: 'Search notes, labels and actions' });
		await fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
		expect(uiStore.paletteOpen).toBe(false);
	});

	it('goes to any place or label from the title, and keeps More for the settings', async () => {
		uiStore.sidebarOpen = false;
		notesStore.labels = [
			{ id: 'travel', name: 'Travel', createdAt: 1, updatedAt: 1 },
			{ id: 'work', name: 'Work', createdAt: 1, updatedAt: 1 }
		];
		render(Topbar);
		await fireEvent.click(
			screen.getByRole('button', { name: 'Notes, go to another place or label' })
		);
		const options = (await screen.findAllByRole('menuitemradio')).map((item) =>
			item.textContent?.trim()
		);
		expect(options).toEqual(['Notes', 'Reminders', 'Kanban', 'Archive', 'Trash', 'Travel', 'Work']);
		expect(screen.getByRole('menuitemradio', { name: 'Notes' }).getAttribute('aria-checked')).toBe(
			'true'
		);

		const archive = screen.getByRole('menuitemradio', { name: 'Archive' });
		await fireEvent.pointerDown(archive, { pointerType: 'mouse' });
		await fireEvent.click(archive);
		expect(uiStore.view).toBe('archive');
		expect(navigation.goto).toHaveBeenCalledWith('/archive');
		expect(closeNote).toHaveBeenCalled();

		await fireEvent.click(
			screen.getByRole('button', { name: 'Archive, go to another place or label' })
		);
		const work = await screen.findByRole('menuitemradio', { name: 'Work' });
		await fireEvent.pointerDown(work, { pointerType: 'mouse' });
		await fireEvent.click(work);
		expect(uiStore.view).toBe('label');
		expect(uiStore.activeLabelId).toBe('work');
		expect(navigation.goto).toHaveBeenCalledWith('/label/work');

		// Making, renaming and deleting labels has its own screen, without the places.
		await fireEvent.click(
			screen.getByRole('button', { name: 'Work, go to another place or label' })
		);
		const edit = await screen.findByRole('menuitem', { name: 'Edit labels…' });
		await fireEvent.pointerDown(edit, { pointerType: 'mouse' });
		await fireEvent.click(edit);
		expect(uiStore.labelsOpen).toBe(true);
		expect(uiStore.sidebarOpen).toBe(false);
		const labelsScreen = await screen.findByRole('dialog', { name: 'Labels' });
		expect(within(labelsScreen).getByRole('button', { name: 'New label' })).toBeTruthy();
		expect(within(labelsScreen).queryByRole('navigation')).toBeNull();
		await fireEvent.click(within(labelsScreen).getByRole('button', { name: 'Close labels' }));
		expect(uiStore.labelsOpen).toBe(false);

		// More holds the settings alone now.
		const more = screen.getByRole('button', { name: 'More' });
		await fireEvent.click(more);
		const moreMenu = document.getElementById(more.getAttribute('aria-controls')!)!;
		const items = within(moreMenu)
			.getAllByRole('menuitem')
			.map((item) => item.textContent?.trim());
		expect(items[0]).toBe('Back up notes…');
		expect(items).not.toContain('Archive');
	});
});
