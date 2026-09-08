// Vitest setup: provide jsdom globals that Svelte components expect.
import 'vitest';
import 'fake-indexeddb/auto';
import { afterEach, vi } from 'vitest';
import { closeDeviceDatabase, DEVICE_DB_NAME } from '$lib/db/idb';
import { resetTombstoneCaches } from '$lib/syncTombstones';

if (typeof Element !== 'undefined' && !Element.prototype.animate) {
	Element.prototype.animate = (() => ({
		cancel: () => {},
		finish: () => {},
		pause: () => {},
		play: () => {},
		reverse: () => {},
		finished: Promise.resolve(),
		addEventListener: () => {},
		removeEventListener: () => {}
	})) as unknown as typeof Element.prototype.animate;
}

if (typeof window !== 'undefined' && !window.ResizeObserver) {
	window.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as typeof ResizeObserver;
}

if (typeof window !== 'undefined') {
	if (!window.URL.createObjectURL) {
		window.URL.createObjectURL = () => 'blob:mock';
	}
	if (!window.URL.revokeObjectURL) {
		window.URL.revokeObjectURL = () => {};
	}
}

// jsdom lacks matchMedia; add a minimal stub.
if (typeof window !== 'undefined' && !window.matchMedia) {
	window.matchMedia = (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false
	});
}

function deleteDatabase(name: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.deleteDatabase(name);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
		request.onblocked = () => resolve();
	});
}

afterEach(async () => {
	vi.useRealTimers();
	resetTombstoneCaches();
	await closeDeviceDatabase();
	await deleteDatabase(DEVICE_DB_NAME);
	if (typeof indexedDB !== 'undefined' && 'databases' in indexedDB) {
		try {
			const dbs = await indexedDB.databases();
			for (const db of dbs) {
				if (db.name) await deleteDatabase(db.name);
			}
		} catch {}
	}
});
