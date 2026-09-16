import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaInstallStore, type BeforeInstallPromptEvent } from './pwaInstall.svelte';

describe('PwaInstallStore', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('initializes with default values and detects non-standalone', () => {
		const store = new PwaInstallStore();
		expect(store.isStandalone).toBe(false);
		expect(store.deferredPrompt).toBeNull();
	});

	it('updates canPrompt when a beforeinstallprompt event is captured', () => {
		const store = new PwaInstallStore();
		expect(store.canPrompt).toBe(false);

		const fakePrompt = {
			preventDefault: vi.fn(),
			prompt: vi.fn().mockResolvedValue(undefined),
			userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' })
		} as unknown as BeforeInstallPromptEvent;

		store.deferredPrompt = fakePrompt;
		expect(store.canPrompt).toBe(true);
	});

	it('triggers deferredPrompt.prompt when promptInstall is called', async () => {
		const store = new PwaInstallStore();
		const promptFn = vi.fn().mockResolvedValue(undefined);
		store.deferredPrompt = {
			prompt: promptFn,
			userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' })
		} as unknown as BeforeInstallPromptEvent;

		await store.promptInstall();
		expect(promptFn).toHaveBeenCalledTimes(1);
		expect(store.deferredPrompt).toBeNull();
	});

	it('hides the install option after the appinstalled event', () => {
		const store = new PwaInstallStore();
		store.deferredPrompt = {
			prompt: vi.fn(),
			userChoice: Promise.resolve({ outcome: 'dismissed' as const, platform: 'web' })
		} as unknown as BeforeInstallPromptEvent;

		expect(store.canPrompt).toBe(true);
		window.dispatchEvent(new Event('appinstalled'));

		expect(store.isStandalone).toBe(true);
		expect(store.canPrompt).toBe(false);
	});
});
