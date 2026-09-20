// Vitest setup: provide jsdom globals that Svelte components expect.
import 'vitest';
import 'fake-indexeddb/auto';
import { afterEach, vi } from 'vitest';
import { closeDeviceDatabase, DEVICE_DB_NAME, dropDatabase } from '$lib/db/idb';
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

// Every case starts on an empty device. `closeDeviceDatabase` settles the
// writes a case left queued and closes their connections, so the deletes below
// are never blocked; one that is blocked anyway means a write outlived its
// test, and `dropDatabase` says so instead of leaving the data for the next
// case to trip over.
afterEach(async () => {
	vi.useRealTimers();
	resetTombstoneCaches();
	if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
	await closeDeviceDatabase();
	// Every name is read before the first delete: a delete that stays blocked
	// also holds up the listing behind it, and the point here is to report the
	// leak, not to hang on it.
	const names = new Set([DEVICE_DB_NAME]);
	if (typeof indexedDB !== 'undefined' && 'databases' in indexedDB) {
		for (const db of await indexedDB.databases()) if (db.name) names.add(db.name);
	}
	for (const name of names) await dropDatabase(name);
});
