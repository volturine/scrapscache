import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PwaInstallSettings from './PwaInstallSettings.svelte';
import { pwaInstallStore, type BeforeInstallPromptEvent } from '$lib/stores/pwaInstall.svelte';

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
		await fireEvent.click(screen.getByRole('button', { name: 'Install app' }));

		expect(prompt).toHaveBeenCalledOnce();
		await waitFor(() => expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull());
	});

	it('removes the install action after the app is installed', async () => {
		pwaInstallStore.deferredPrompt = {
			prompt: vi.fn(),
			userChoice: Promise.resolve({ outcome: 'dismissed' as const, platform: 'web' })
		} as unknown as BeforeInstallPromptEvent;

		render(PwaInstallSettings);
		expect(screen.getByRole('button', { name: 'Install app' })).toBeTruthy();

		window.dispatchEvent(new Event('appinstalled'));

		await waitFor(() => expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull());
	});

	it('does not render a dismiss control', async () => {
		pwaInstallStore.deferredPrompt = {
			prompt: vi.fn(),
			userChoice: Promise.resolve({ outcome: 'dismissed' as const, platform: 'web' })
		} as unknown as BeforeInstallPromptEvent;

		render(PwaInstallSettings);
		expect(screen.getByRole('button', { name: 'Install app' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Dismiss install prompt' })).toBeNull();
	});
});
