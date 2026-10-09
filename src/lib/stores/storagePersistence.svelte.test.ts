import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoragePersistenceStore, storagePersistenceStore } from './storagePersistence.svelte.js';

function stubStorage(persisted: boolean, grant: boolean) {
	const storage = {
		persisted: vi.fn().mockResolvedValue(persisted),
		persist: vi.fn().mockResolvedValue(grant)
	};
	vi.stubGlobal('navigator', { ...navigator, storage });
	return storage;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('StoragePersistenceStore', () => {
	it('reports best-effort storage until persistence is granted', async () => {
		stubStorage(false, true);
		const store = new StoragePersistenceStore();
		expect(await store.refresh()).toBe('best-effort');
		expect(await store.request()).toBe('persisted');
		expect(store.state).toBe('persisted');
		expect(store.denied).toBe(false);
	});

	it('records a refusal', async () => {
		stubStorage(false, false);
		const store = new StoragePersistenceStore();
		expect(await store.request()).toBe('best-effort');
		expect(store.denied).toBe(true);
	});

	it('asks only once per page load', async () => {
		const storage = stubStorage(false, false);
		const store = new StoragePersistenceStore();
		await store.refresh();
		store.requestOnce();
		store.requestOnce();
		await vi.waitFor(() => expect(store.denied).toBe(true));
		expect(storage.persist).toHaveBeenCalledOnce();
	});

	it('does not ask when storage is already persistent', async () => {
		const storage = stubStorage(true, true);
		const store = new StoragePersistenceStore();
		await store.refresh();
		store.requestOnce();
		expect(storage.persist).not.toHaveBeenCalled();
	});

	it('asks again once the app is installed', async () => {
		const storage = stubStorage(false, true);
		await storagePersistenceStore.refresh();
		expect(storage.persist).not.toHaveBeenCalled();
		window.dispatchEvent(new Event('appinstalled'));
		await vi.waitFor(() => expect(storagePersistenceStore.state).toBe('persisted'));
		expect(storage.persist).toHaveBeenCalledOnce();
	});

	it('is unsupported without the Storage API', async () => {
		vi.stubGlobal('navigator', { ...navigator, storage: undefined });
		const store = new StoragePersistenceStore();
		expect(await store.refresh()).toBe('unsupported');
		expect(await store.request()).toBe('unsupported');
	});
});
