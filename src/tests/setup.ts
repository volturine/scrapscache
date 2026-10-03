// Vitest setup: provide jsdom globals that Svelte components expect.
import 'vitest';
import 'fake-indexeddb/auto';
import { afterEach, vi } from 'vitest';
import { closeDeviceDatabase, DEVICE_DB_NAME, dropDatabase } from '#lib/db/idb.js';
import { resetTombstoneCaches } from '#lib/syncTombstones.js';
import { installHorizontalWheel } from '#lib/horizontalWheel.js';
import { resetEnv } from './env';
import { seedTestKeyring } from './workspace';

// Stores boot on the keyring's workspace; every test file starts on the same one.
seedTestKeyring();

// `$app/env/*` are generated per app; tests set values through `./env`.
vi.mock('$app/env/private', async () => (await import('./env')).envModule(false));
vi.mock('$app/env/public', async () => (await import('./env')).envModule(true));

// jsdom does not implement viewport scrolling; component navigation still calls it.
if (typeof window !== 'undefined') window.scrollTo = vi.fn();

// Same Shift+wheel path the app installs in hooks.client.
installHorizontalWheel();

if (typeof Element !== 'undefined' && !Element.prototype.animate) {
	Element.prototype.animate = (() => {
		const animation = {
			onfinish: null as (() => void) | null,
			cancel: () => {},
			finish: () => {},
			pause: () => {},
			play: () => {},
			reverse: () => {},
			finished: Promise.resolve(),
			addEventListener: () => {},
			removeEventListener: () => {}
		};
		// Finish on the next task, as a real animation would, so Svelte outros
		// remove their elements instead of waiting forever.
		setTimeout(() => animation.onfinish?.());
		return animation;
	}) as unknown as typeof Element.prototype.animate;
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
if (typeof document !== 'undefined' && !document.elementsFromPoint) {
	document.elementsFromPoint = () => [];
}

if (typeof window !== 'undefined' && !window.ResizeObserver) {
	window.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as typeof ResizeObserver;
}

// jsdom has no blob URL support, and vitest's jsdom createObjectURL compat
// crashes on jsdom >= 30.1.0 because jsdom moved impl references to private fields.
if (typeof URL !== 'undefined') {
	URL.createObjectURL = () => 'blob:mock';
	URL.revokeObjectURL = () => {};
}
if (typeof window !== 'undefined' && window.URL) {
	window.URL.createObjectURL = () => 'blob:mock';
	window.URL.revokeObjectURL = () => {};
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
	resetEnv();
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
