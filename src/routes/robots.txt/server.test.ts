import { afterEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('$env/dynamic/private', () => ({ env: envMock }));

import { GET } from './+server';

async function body(): Promise<string> {
	return (await (GET as unknown as () => Response)()).text();
}

describe('robots.txt', () => {
	afterEach(() => delete envMock.SCRAPSCACHE_ALLOW_INDEXING);

	it('invites crawlers only where indexing is explicitly enabled', async () => {
		envMock.SCRAPSCACHE_ALLOW_INDEXING = 'true';
		expect(await body()).toBe('User-agent: *\nDisallow:\n');
	});

	it('keeps preview and self-hosted origins out of search results by default', async () => {
		expect(await body()).toBe('User-agent: *\nDisallow: /\n');
		envMock.SCRAPSCACHE_ALLOW_INDEXING = 'false';
		expect(await body()).toBe('User-agent: *\nDisallow: /\n');
	});
});
