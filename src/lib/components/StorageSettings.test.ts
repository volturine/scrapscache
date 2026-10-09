import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StorageSettings from './StorageSettingsMenuHost.svelte';
import { storagePersistenceStore } from '#lib/stores/storagePersistence.svelte.js';

afterEach(() => {
	storagePersistenceStore.state = 'unsupported';
	vi.restoreAllMocks();
});

describe('StorageSettings', () => {
	it('offers to keep notes when storage may be cleared', async () => {
		storagePersistenceStore.state = 'best-effort';
		const request = vi
			.spyOn(storagePersistenceStore, 'request')
			.mockImplementation(async () => (storagePersistenceStore.state = 'persisted'));

		render(StorageSettings);
		await fireEvent.click(screen.getByRole('button', { name: 'Open settings menu' }));
		const item = screen.getByRole('menuitem', { name: 'Keep notes on this device' });
		expect(item.textContent).toContain('May be cleared');
		await fireEvent.pointerDown(item, { pointerType: 'mouse' });
		await fireEvent.click(item);

		expect(request).toHaveBeenCalledOnce();
		await waitFor(() => expect(screen.getByText('Persistent')).toBeTruthy());
		expect(screen.queryByRole('menuitem', { name: 'Keep notes on this device' })).toBeNull();
	});

	it('shows nothing when the browser has no Storage API', async () => {
		render(StorageSettings);
		await fireEvent.click(screen.getByRole('button', { name: 'Open settings menu' }));
		expect(screen.queryByText('Storage')).toBeNull();
	});
});
