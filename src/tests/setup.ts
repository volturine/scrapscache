// Vitest setup: provide jsdom globals that Svelte components expect.
import 'vitest';
import 'fake-indexeddb/auto';
import { afterEach, vi } from 'vitest';
import { closeDeviceDatabase, DEVICE_DB_NAME } from '$lib/db/idb';
import { resetTombstoneCaches } from '$lib/syncTombstones';

// Browser-side $env/dynamic/public reads globals that only a SvelteKit page defines.
vi.mock('$env/dynamic/public', () => ({ env: {} }));

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

// jsdom has no pointer capture; gestures call it on every press.
if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) {
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	Element.prototype.hasPointerCapture = () => false;
}

// jsdom has no hit testing; drag code asks what sits under the pointer.
if (typeof document !== 'undefined' && !document.elementFromPoint) {
	document.elementFromPoint = () => null;
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
	if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
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
