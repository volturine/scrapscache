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

	it('names the view in plain text, Labels while its screen is open, and keeps More for the settings', async () => {
		render(Topbar);
		const title = document.querySelector('[data-view-title]')!;
		// The tab bar goes places; the title is not a control.
		expect(title.closest('button')).toBeNull();
		uiStore.labelsOpen = true;
		await waitFor(() => expect(title.textContent).toBe('Labels'));

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
