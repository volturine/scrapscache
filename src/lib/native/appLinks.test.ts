import { afterEach, describe, expect, it, vi } from 'vitest';

const app = vi.hoisted(() => ({
	listeners: new Map<string, (event: { url: string }) => void>()
}));
vi.mock('@capacitor/app', () => ({
	App: {
		addListener: async (name: string, handler: (event: { url: string }) => void) => {
			app.listeners.set(name, handler);
			return { remove: async () => undefined };
		}
	}
}));

import { linkFragment, onAppLink } from './appLinks.js';

afterEach(() => {
	app.listeners.clear();
	window.location.hash = '';
});

describe('a link to the web app opened in the iPhone app', () => {
	it('is read for its fragment, which names the note or the pairing code', () => {
		expect(linkFragment('https://scrapscache.com/#w=abc&note=n1')).toBe('#w=abc&note=n1');
		expect(linkFragment('https://scrapscache.com/#pair=ABCD-EFGH')).toBe('#pair=ABCD-EFGH');
	});

	it('is nothing to follow without a fragment, or when it is not a web link', () => {
		expect(linkFragment('https://scrapscache.com/')).toBeNull();
		expect(linkFragment('https://scrapscache.com/#')).toBeNull();
		expect(linkFragment('scrapscache://open#note=n1')).toBeNull();
		expect(linkFragment('not a link')).toBeNull();
	});

	it('becomes the page’s own address, in place of the one it had', async () => {
		window.location.hash = '#w=old&note=n0';
		await onAppLink();
		app.listeners.get('appUrlOpen')?.({ url: 'https://scrapscache.com/#w=abc&note=n1' });
		expect(window.location.hash).toBe('#w=abc&note=n1');
	});

	it('leaves the page’s address alone for a link with nothing to follow', async () => {
		window.location.hash = '#w=old&note=n0';
		await onAppLink();
		app.listeners.get('appUrlOpen')?.({ url: 'https://scrapscache.com/' });
		expect(window.location.hash).toBe('#w=old&note=n0');
	});
});
