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
	it('asks to keep notes when storage may be cleared', async () => {
		storagePersistenceStore.state = 'best-effort';
		const request = vi
			.spyOn(storagePersistenceStore, 'request')
			.mockImplementation(async () => (storagePersistenceStore.state = 'persisted'));

		await openMenu();
		await select(screen.getByRole('menuitem', { name: /Storage\s*May be cleared/ }));

		expect(request).toHaveBeenCalledOnce();
		await waitFor(() => expect(screen.getByText('Persistent')).toBeTruthy());
		expect(screen.queryByRole('menuitem', { name: /Storage/ })).toBeNull();
	});

	it('says so and points to export or sync when the browser refuses', async () => {
		storagePersistenceStore.state = 'best-effort';
		vi.spyOn(storagePersistenceStore, 'request').mockImplementation(async () => {
			storagePersistenceStore.denied = true;
			return storagePersistenceStore.state;
		});

		await openMenu();
		await select(screen.getByRole('menuitem', { name: /Storage\s*May be cleared/ }));

		await waitFor(() => expect(screen.getByText('Not granted')).toBeTruthy());
		expect(screen.getByText(/Export a backup or turn on sync/)).toBeTruthy();
		expect(screen.queryByRole('menuitem', { name: /Storage/ })).toBeNull();
	});

	it('shows nothing when the browser has no Storage API', async () => {
		await openMenu();
		expect(screen.queryByText('Storage')).toBeNull();
	});
});
