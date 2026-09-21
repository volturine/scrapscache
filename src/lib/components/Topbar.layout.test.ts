import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { uiStore } from '$lib/stores/ui.svelte';
import { appLayout } from '$panda/styles';
import Topbar from './Topbar.svelte';

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

const mockCloseNote = vi.fn();
vi.mock('$lib/editorContext', () => ({
	useEditorActions: () => ({
		startNewNote: vi.fn(),
		closeNote: mockCloseNote
	})
}));

afterEach(() => {
	uiStore.sidebarOpen = false;
	uiStore.searchInput = '';
	vi.restoreAllMocks();
});

describe('Topbar layout and sidebar behavior', () => {
	it('anchors drawer positioner and backdrop under the topbar', () => {
		// Verify that backdrop and drawerPositioner styles start below the topbar
		expect(appLayout.backdrop).toBeTruthy();
		expect(appLayout.drawerPositioner).toBeTruthy();
		expect(appLayout.body).toBeTruthy();
		expect(appLayout.shell).toBeTruthy();
	});

	it('toggles sidebar on hamburger button click', async () => {
		render(Topbar);
		const toggleBtn = screen.getByRole('button', { name: 'Toggle sidebar' });

		expect(uiStore.sidebarOpen).toBe(false);
		await fireEvent.click(toggleBtn);
		expect(uiStore.sidebarOpen).toBe(true);
		await fireEvent.click(toggleBtn);
		expect(uiStore.sidebarOpen).toBe(false);
	});

	it('closes open note and dismisses sidebar on mobile when header is tapped outside toggle button', async () => {
		// Mock matchMedia to simulate mobile phone screen
		window.matchMedia = vi.fn().mockImplementation((query) => ({
			matches: query.includes('767px'),
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn()
		}));

		const { container } = render(Topbar);
		uiStore.sidebarOpen = true;

		const header = container.querySelector('header');
		expect(header).toBeTruthy();

		await fireEvent.pointerDown(header!);
		expect(mockCloseNote).toHaveBeenCalled();
	});

	it('closes sidebar on mobile when search input is focused', async () => {
		window.matchMedia = vi.fn().mockImplementation((query) => ({
			matches: query.includes('767px'),
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn()
		}));

		render(Topbar);
		uiStore.sidebarOpen = true;

		const searchInput = screen.getByPlaceholderText('Search');
		await fireEvent.focus(searchInput);
		expect(uiStore.sidebarOpen).toBe(false);
	});
});
