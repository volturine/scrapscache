import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
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
	uiStore.searchOpen = false;
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

	it('shows the search field, focused, while the Search tab is on, and closes it', async () => {
		render(Topbar);
		uiStore.searchOpen = true;
		const field = await screen.findByRole('searchbox', { name: 'Search notes' });
		await tick();
		await waitFor(() => expect(document.activeElement).toBe(field));
		expect(document.querySelector('[data-view-title]')).toBeNull();

		await fireEvent.input(field, { target: { value: 'retro' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
		expect(uiStore.searchOpen).toBe(false);
		expect(uiStore.searchInput).toBe('');
		await waitFor(() => expect(screen.queryByRole('searchbox')).toBeNull());
		expect(document.querySelector('[data-view-title]')?.textContent).toBe('Notes');
	});

	it('puts Labels, Archive and Trash under More, ahead of the settings', async () => {
		uiStore.sidebarOpen = false;
		render(Topbar);
		await fireEvent.click(screen.getByRole('button', { name: 'More' }));
		const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent?.trim());
		expect(items.slice(0, 3)).toEqual(['Labels', 'Archive', 'Trash']);
		expect(items).toContain('Back up notes…');

		const archive = screen.getByRole('menuitem', { name: 'Archive' });
		await fireEvent.pointerDown(archive, { pointerType: 'mouse' });
		await fireEvent.click(archive);
		expect(uiStore.view).toBe('archive');
		expect(navigation.goto).toHaveBeenCalledWith('/archive');
		expect(closeNote).toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'More' }));
		const labels = await screen.findByRole('menuitem', { name: 'Labels' });
		await fireEvent.pointerDown(labels, { pointerType: 'mouse' });
		await fireEvent.click(labels);
		// The drawer is the labels screen on a phone.
		expect(uiStore.sidebarOpen).toBe(true);
	});
});
