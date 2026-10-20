import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { syncStore } from '#lib/stores/sync.svelte.js';
import { uiStore } from '#lib/stores/ui.svelte.js';
import { TEST_WORKSPACE } from '../../tests/workspace';
import SyncAttentionBanner from './SyncAttentionBanner.svelte';

const DAY = 24 * 60 * 60 * 1000;

function openSyncedWorkspace() {
	const profile = {
		id: 'banner-synced',
		name: 'Synced',
		syncKey: createSyncIdentity().syncKey,
		createdAt: 1
	};
	syncStore.profiles = [profile];
	syncStore.activateProfile(profile);
}

function banner() {
	return document.querySelector('[data-sync-attention]');
}

describe('SyncAttentionBanner', () => {
	beforeEach(() => {
		openSyncedWorkspace();
		syncStore.lastError = null;
		syncStore.keyRetired = false;
		syncStore.usage = null;
		syncStore.lastSync = Date.now();
		uiStore.syncOpen = false;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		syncStore.lastError = null;
		syncStore.keyRetired = false;
		syncStore.usage = null;
		syncStore.activateLocalWorkspace(TEST_WORKSPACE);
		syncStore.profiles = [];
		uiStore.syncOpen = false;
	});

	it('shows nothing while sync is quiet, or for a workspace that does not sync', async () => {
		render(SyncAttentionBanner);
		expect(banner()).toBeNull();
		// The live region is there before it has anything to say, so it is heard when it does.
		const region = document.querySelector('[data-sync-attention-region]')!;
		expect(region.textContent?.trim()).toBe('');

		syncStore.activateLocalWorkspace(TEST_WORKSPACE);
		syncStore.lastError = 'Failed to fetch';
		await tick();
		expect(banner()).toBeNull();
	});

	it('offers a retry for a sync error and goes away when dismissed, until a new error', async () => {
		const retry = vi.spyOn(notesStore, 'syncWithCloudManual').mockResolvedValue(true);
		render(SyncAttentionBanner);

		syncStore.lastError = 'TypeError: Failed to fetch';
		await tick();
		expect(banner()?.getAttribute('data-sync-attention')).toBe('error');
		expect(screen.getByText('Sync stopped: the server could not be reached.')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(retry).toHaveBeenCalledOnce();

		await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
		expect(banner()).toBeNull();

		// The same error stays dismissed; a different one is news.
		syncStore.lastError = 'Encrypted sync failed: bad record';
		await tick();
		expect(screen.getByText('Sync stopped: Encrypted sync failed: bad record.')).toBeTruthy();
	});

	it('says it inside the region that was already there', async () => {
		render(SyncAttentionBanner);
		const region = document.querySelector('[data-sync-attention-region]')!;
		syncStore.lastError = 'TypeError: Failed to fetch';
		await tick();

		expect(region.contains(banner())).toBe(true);
		expect(region.textContent).toContain('Sync stopped: the server could not be reached.');
	});

	it('keeps a dismissed warning away while a later error comes and goes above it', async () => {
		render(SyncAttentionBanner);
		syncStore.usage = { ciphertextBytes: 0, envelopeCount: 0, storageBytes: 85, maxBytes: 100 };
		await tick();
		await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
		expect(banner()).toBeNull();

		syncStore.lastError = 'TypeError: Failed to fetch';
		await tick();
		expect(banner()?.getAttribute('data-sync-attention')).toBe('error');
		await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
		expect(banner()).toBeNull();

		// The error clears; the storage warning never did, so it stays dismissed.
		syncStore.lastError = null;
		await tick();
		expect(banner()).toBeNull();
	});

	it('shows a warning from a sync that went through as written, with a retry', async () => {
		render(SyncAttentionBanner);
		syncStore.lastError = 'Skipped 1 unreadable sync record';
		await tick();

		expect(screen.getByText('Skipped 1 unreadable sync record')).toBeTruthy();
		expect(screen.queryByText(/Sync stopped/)).toBeNull();
		expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
	});

	it('shows a dismissed state again once it has cleared and come back', async () => {
		render(SyncAttentionBanner);
		syncStore.usage = { ciphertextBytes: 0, envelopeCount: 0, storageBytes: 85, maxBytes: 100 };
		await tick();
		await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
		expect(banner()).toBeNull();

		syncStore.usage = { ciphertextBytes: 0, envelopeCount: 0, storageBytes: 10, maxBytes: 100 };
		await tick();
		syncStore.usage = { ciphertextBytes: 0, envelopeCount: 0, storageBytes: 90, maxBytes: 100 };
		await tick();
		expect(screen.getByText('Cloud storage is 90% full.')).toBeTruthy();
	});

	it('opens Sync settings for a retired key, with no way to dismiss', async () => {
		render(SyncAttentionBanner);
		syncStore.keyRetired = true;
		await tick();

		expect(screen.getByText('This workspace can no longer sync.')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Create new key' }));
		expect(uiStore.syncOpen).toBe(true);
	});

	it('opens the workspaces when cloud storage is nearly full', async () => {
		render(SyncAttentionBanner);
		syncStore.usage = { ciphertextBytes: 0, envelopeCount: 0, storageBytes: 85, maxBytes: 100 };
		await tick();

		await fireEvent.click(screen.getByRole('button', { name: 'Open workspaces' }));
		expect(uiStore.syncOpen).toBe(true);
	});

	it('says how long the device has been offline without a sync', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		syncStore.lastSync = Date.now() - 2 * DAY - 60_000;
		render(SyncAttentionBanner);
		await tick();

		expect(banner()?.getAttribute('data-sync-attention')).toBe('offline');
		expect(screen.getByText('Offline for 2 days.')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Retry|Open/ })).toBeNull();
	});
});
