import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uiStore } from '#lib/stores/ui.svelte.js';
import PhoneTabBar from './PhoneTabBar.svelte';

const navigation = vi.hoisted(() => ({ goto: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => navigation);

const closeNote = vi.fn();
vi.mock('#lib/editorContext.js', () => ({
	useEditorActions: () => ({ startNewNote: vi.fn(), openNote: vi.fn(), closeNote })
}));

afterEach(() => {
	uiStore.setView('notes');
	uiStore.paletteOpen = false;
	navigation.goto.mockClear();
	closeNote.mockClear();
});

describe('PhoneTabBar', () => {
	it('offers Notes, Reminders, Kanban and Search, with the current place marked', () => {
		uiStore.setView('reminders');
		render(PhoneTabBar);
		const tabs = screen.getAllByRole('button').map((tab) => tab.textContent?.trim());
		expect(tabs).toEqual(['Notes', 'Reminders', 'Kanban', 'Search']);
		expect(screen.getByRole('button', { name: 'Reminders' }).getAttribute('aria-current')).toBe(
			'page'
		);
		expect(screen.getByRole('button', { name: 'Notes' }).getAttribute('aria-current')).toBeNull();
		expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
	});

	it('goes to a place, closing an open note first', async () => {
		render(PhoneTabBar);
		await fireEvent.click(screen.getByRole('button', { name: 'Kanban' }));
		expect(closeNote).toHaveBeenCalled();
		expect(uiStore.view).toBe('kanban');
		expect(navigation.goto).toHaveBeenCalledWith('/kanban');
	});

	it('opens the palette from Search', async () => {
		render(PhoneTabBar);
		const search = screen.getByRole('button', { name: 'Search' });
		expect(search.getAttribute('aria-haspopup')).toBe('dialog');
		expect(search.getAttribute('aria-expanded')).toBe('false');

		await fireEvent.click(search);
		expect(uiStore.paletteOpen).toBe(true);
		expect(search.getAttribute('aria-expanded')).toBe('true');
	});
});
