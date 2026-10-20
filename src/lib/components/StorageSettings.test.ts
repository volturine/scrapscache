import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StorageSettings from './StorageSettingsMenuHost.svelte';
import { storagePersistenceStore } from '#lib/stores/storagePersistence.svelte.js';

afterEach(() => {
	storagePersistenceStore.state = 'unsupported';
	storagePersistenceStore.denied = false;
	vi.restoreAllMocks();
});

async function openMenu() {
	render(StorageSettings);
	await fireEvent.click(screen.getByRole('button', { name: 'Open settings menu' }));
}

async function select(item: HTMLElement) {
	await fireEvent.pointerDown(item, { pointerType: 'mouse' });
	await fireEvent.click(item);
}

describe('StorageSettings', () => {
	it('asks to keep notes when storage may be cleared, and says so in a sentence', async () => {
		storagePersistenceStore.state = 'best-effort';
		const request = vi
			.spyOn(storagePersistenceStore, 'request')
			.mockImplementation(async () => (storagePersistenceStore.state = 'persisted'));

		await openMenu();
		await select(
			screen.getByRole('menuitem', {
				name: /Keep notes on this device/,
				description: 'Not guaranteed: the browser may delete them. Tap to ask it to keep them.'
			})
		);

		expect(request).toHaveBeenCalledOnce();
		// The state stays reachable from the keyboard, as a passive item.
		await waitFor(() =>
			expect(
				screen.getByRole('menuitem', {
					name: /Keep notes on this device/,
					description: 'Kept: the browser will not clear them on its own.'
				})
			).toBeTruthy()
		);
		expect(screen.queryByText(/Tap to ask/)).toBeNull();
	});

	it('says so and points to export or sync when the browser refuses', async () => {
		storagePersistenceStore.state = 'best-effort';
		vi.spyOn(storagePersistenceStore, 'request').mockImplementation(async () => {
			storagePersistenceStore.denied = true;
			return storagePersistenceStore.state;
		});

		await openMenu();
		await select(screen.getByRole('menuitem', { name: /Keep notes on this device/ }));

		await waitFor(() =>
			expect(
				screen.getByRole('menuitem', {
					name: /Keep notes on this device/,
					description: /Not granted: .*Export a backup or turn on sync/
				})
			).toBeTruthy()
		);
		expect(screen.queryByText(/Tap to ask/)).toBeNull();
	});

	it('shows nothing when the browser has no Storage API', async () => {
		await openMenu();
		expect(screen.queryByText(/Keep notes on this device/)).toBeNull();
	});
});
