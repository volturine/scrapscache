import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PwaInstallSettings from './PwaInstallSettingsMenuHost.svelte';
import { pwaInstallStore, type BeforeInstallPromptEvent } from '#lib/stores/pwaInstall.svelte.js';

function resetStore() {
	pwaInstallStore.deferredPrompt = null;
	pwaInstallStore.isStandalone = false;
	pwaInstallStore.showIOSHelp = false;
}

afterEach(resetStore);

describe('PwaInstallSettings', () => {
	it('renders the install action in Settings when the app can be installed', async () => {
		const prompt = vi.fn().mockResolvedValue(undefined);
		pwaInstallStore.deferredPrompt = {
			prompt,
			userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' })
		} as unknown as BeforeInstallPromptEvent;

		render(PwaInstallSettings);
		await fireEvent.click(screen.getByRole('button', { name: 'Open settings menu' }));
		const installButton = screen.getByRole('menuitem', { name: 'Install app' });
		expect(installButton.className).toContain('scrapscache-menu-item');
		await fireEvent.pointerDown(installButton, { pointerType: 'mouse' });
		await fireEvent.click(installButton);

		expect(prompt).toHaveBeenCalledOnce();
		await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Install app' })).toBeNull());
	});

	it('removes the install action after the app is installed', async () => {
		pwaInstallStore.deferredPrompt = {
			prompt: vi.fn(),
			userChoice: Promise.resolve({ outcome: 'dismissed' as const, platform: 'web' })
		} as unknown as BeforeInstallPromptEvent;

		render(PwaInstallSettings);
		await fireEvent.click(screen.getByRole('button', { name: 'Open settings menu' }));
		expect(screen.getByRole('menuitem', { name: 'Install app' })).toBeTruthy();

		window.dispatchEvent(new Event('appinstalled'));

		await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Install app' })).toBeNull());
	});

	it('does not render a dismiss control', async () => {
		pwaInstallStore.deferredPrompt = {
			prompt: vi.fn(),
			userChoice: Promise.resolve({ outcome: 'dismissed' as const, platform: 'web' })
		} as unknown as BeforeInstallPromptEvent;

		render(PwaInstallSettings);
		await fireEvent.click(screen.getByRole('button', { name: 'Open settings menu' }));
		expect(screen.getByRole('menuitem', { name: 'Install app' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Dismiss install prompt' })).toBeNull();
	});

	it('shows the iOS steps as a modal dialog that Got it closes', async () => {
		render(PwaInstallSettings);
		await fireEvent.click(screen.getByRole('button', { name: 'Open settings menu' }));
		pwaInstallStore.showIOSHelp = true;

		const dialog = await screen.findByRole('dialog', { name: 'Install Scraps Cache' });
		expect(dialog.getAttribute('aria-modal')).toBe('true');

		await fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
		expect(pwaInstallStore.showIOSHelp).toBe(false);
	});
});
