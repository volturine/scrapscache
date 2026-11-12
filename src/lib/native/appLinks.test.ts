import { afterEach, describe, expect, it, vi } from 'vitest';

const SERVER = 'https://scrapscache.com';

const app = vi.hoisted(() => ({
	listeners: new Map<string, (event: { url: string }) => void>(),
	server: 'https://scrapscache.com'
}));
vi.mock('@capacitor/app', () => ({
	App: {
		addListener: async (name: string, handler: (event: { url: string }) => void) => {
			app.listeners.set(name, handler);
			return { remove: async () => undefined };
		}
	}
}));
vi.mock('#lib/serverOrigin.svelte.js', () => ({
	serverSetting: {
		get origin() {
			return app.server;
		}
	}
}));

import { linkFragment, onAppLink } from './appLinks.js';

afterEach(() => {
	app.listeners.clear();
	app.server = SERVER;
	window.location.hash = '';
});

describe('a link to the web app opened in the iPhone app', () => {
	it('is read for its fragment, which names the note or the pairing code', () => {
		expect(linkFragment(`${SERVER}/#w=abc&note=n1`, SERVER)).toBe('#w=abc&note=n1');
		expect(linkFragment(`${SERVER}/#pair=ABCD-EFGH`, SERVER)).toBe('#pair=ABCD-EFGH');
	});

	it('is followed from whichever view of the web app it was made on', () => {
		expect(linkFragment(`${SERVER}/archive#pair=ABCD-EFGH`, SERVER)).toBe('#pair=ABCD-EFGH');
		expect(linkFragment(`${SERVER}/label/work#w=abc&note=n1`, SERVER)).toBe('#w=abc&note=n1');
	});

	it('is nothing to follow without a fragment, or when it is not a link at all', () => {
		expect(linkFragment(`${SERVER}/`, SERVER)).toBeNull();
		expect(linkFragment(`${SERVER}/#`, SERVER)).toBeNull();
		expect(linkFragment('scrapscache://open#note=n1', SERVER)).toBeNull();
		expect(linkFragment('not a link', SERVER)).toBeNull();
	});

	it('is not followed when it is a link to another server than the app syncs with', () => {
		expect(linkFragment('https://dev.scrapscache.com/#pair=ABCD-EFGH', SERVER)).toBeNull();
		expect(linkFragment('http://scrapscache.com/#pair=ABCD-EFGH', SERVER)).toBeNull();
		expect(linkFragment(`${SERVER}:8443/#pair=ABCD-EFGH`, SERVER)).toBeNull();
	});

	it('becomes the page’s own address, in place of the one it had', async () => {
		window.location.hash = '#w=old&note=n0';
		await onAppLink();
		app.listeners.get('appUrlOpen')?.({ url: `${SERVER}/#w=abc&note=n1` });
		expect(window.location.hash).toBe('#w=abc&note=n1');
	});

	it('leaves the page’s address alone for a link with nothing to follow', async () => {
		window.location.hash = '#w=old&note=n0';
		await onAppLink();
		app.listeners.get('appUrlOpen')?.({ url: `${SERVER}/` });
		expect(window.location.hash).toBe('#w=old&note=n0');
	});

	it('leaves the page alone when the app has been pointed at a server of its own', async () => {
		// The app is built to claim the hosted service's links, and iOS still hands
		// them over; the pairing they name is on a server this app does not talk to.
		app.server = 'https://notes.example';
		window.location.hash = '#w=old&note=n0';
		await onAppLink();
		app.listeners.get('appUrlOpen')?.({ url: `${SERVER}/#pair=ABCD-EFGH-JKMN-PQRS` });
		expect(window.location.hash).toBe('#w=old&note=n0');
	});
});
