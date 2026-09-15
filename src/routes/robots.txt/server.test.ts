import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ allowIndexing: false }));
vi.mock('$lib/server/runtimeSettings', () => ({
	getRuntimeSettings: async () => ({ allowIndexing: mocks.allowIndexing })
}));

import { GET } from './+server';

async function body(): Promise<string> {
	const get = GET as unknown as (event: { url: URL }) => Promise<Response>;
	return (await get({ url: new URL('https://scrapscache.com/robots.txt') })).text();
}

describe('robots.txt', () => {
	it('invites crawlers only where indexing is explicitly enabled', async () => {
		mocks.allowIndexing = true;
		expect(await body()).toBe(
			'User-agent: *\nDisallow:\n\nSitemap: https://scrapscache.com/sitemap.xml\n'
		);
	});

	it('keeps preview and self-hosted origins out of search results by default', async () => {
		mocks.allowIndexing = false;
		expect(await body()).toBe('User-agent: *\nDisallow: /\n');
	});
});
