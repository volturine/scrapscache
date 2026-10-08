import { afterEach, describe, expect, it, vi } from 'vitest';
import { kanbanStore } from './kanban.svelte';
import { notesStore } from './notes.svelte';

describe('booting without a readable device store', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		notesStore.notes = [];
		notesStore.labels = [];
		notesStore.lastPersistError = null;
	});

	it('finishes the boot when the boards cannot be read, and says so', async () => {
		vi.spyOn(kanbanStore, 'hydrateFromDevice').mockRejectedValueOnce(
			new Error('IndexedDB is not available')
		);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		notesStore.loaded = false;

		await expect(notesStore.init()).resolves.toBeUndefined();

		expect(notesStore.loaded).toBe(true);
		expect(notesStore.lastPersistError).toMatch(/boards.*IndexedDB is not available/);
	});
});
