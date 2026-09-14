import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import BottomNav from './BottomNav.svelte';
import { pwaInstallStore } from '$lib/stores/pwaInstall.svelte';

const startNewNote = vi.fn();

vi.mock('$lib/editorContext', () => ({
	useEditorActions: () => ({
		startNewNote,
		openNote: vi.fn(),
		closeNote: vi.fn()
	})
}));

describe('BottomNav', () => {
	it('triggers startNewNote when the floating action button is clicked', async () => {
		render(BottomNav);
		const fab = screen.getByRole('button', { name: 'New note' });
		expect(fab).toBeTruthy();

		await fireEvent.click(fab);
		expect(startNewNote).toHaveBeenCalledTimes(1);
	});

	it('renders sticky install button when canPrompt is true', async () => {
		pwaInstallStore.isStandalone = false;
		pwaInstallStore.dismissed = false;
		const promptSpy = vi.fn().mockResolvedValue(undefined);
		pwaInstallStore.deferredPrompt = {
			prompt: promptSpy,
			userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' })
		} as any;

		render(BottomNav);

		const installBtn = screen.getByRole('button', { name: /install app/i });
		expect(installBtn).toBeTruthy();

		const dismissBtn = screen.getByRole('button', { name: /dismiss install prompt/i });
		expect(dismissBtn).toBeTruthy();

		await fireEvent.click(installBtn);
		expect(promptSpy).toHaveBeenCalledTimes(1);
	});
});
