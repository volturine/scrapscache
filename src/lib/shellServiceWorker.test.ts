/**
 * The shell cache. A navigation answered with an error page, or with a
 * redirect, must not become what the app shows offline.
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const ORIGIN = 'https://scrapscache.example';

function loadFetchHandler(fetch: ReturnType<typeof vi.fn>) {
	const cache = { put: vi.fn(async () => undefined), match: vi.fn(async () => undefined) };
	const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => []) };
	const listeners = new Map<string, (event: unknown) => void>();
	const self = {
		location: { origin: ORIGIN },
		registration: { showNotification: vi.fn(), scope: `${ORIGIN}/` },
		clients: {},
		addEventListener(type: string, listener: (event: unknown) => void) {
			listeners.set(type, listener);
		},
		skipWaiting: vi.fn()
	};
	runInNewContext(readFileSync('static/sw.js', 'utf8'), {
		self,
		URL,
		URLSearchParams,
		Request,
		Response,
		fetch,
		caches,
		setTimeout,
		clearTimeout,
		btoa
	});
	const handler = listeners.get('fetch');
	if (!handler) throw new Error('Service worker did not register a fetch handler');
	return {
		cache,
		async navigate(path = '/') {
			let answered: Promise<unknown> | null = null;
			handler({
				request: { method: 'GET', url: `${ORIGIN}${path}`, mode: 'navigate' },
				respondWith(promise: Promise<unknown>) {
					answered = promise;
				}
			});
			const response = await answered;
			// The cache write is fire-and-forget; let it land before looking.
			await new Promise((resolve) => setTimeout(resolve, 0));
			return response;
		}
	};
}

describe('shell service worker', () => {
	it('caches a good page as the shell', async () => {
		const page = new Response('<!doctype html>', { status: 200 });
		const sw = loadFetchHandler(vi.fn(async () => page));

		expect(await sw.navigate('/')).toBe(page);

		expect(sw.cache.put).toHaveBeenCalledTimes(1);
	});

	it('does not cache an error page as the shell', async () => {
		const outage = new Response('Service Unavailable', { status: 503 });
		const sw = loadFetchHandler(vi.fn(async () => outage));

		expect(await sw.navigate('/')).toBe(outage);

		expect(sw.cache.put).not.toHaveBeenCalled();
	});

	it('does not cache a redirected page, which a navigation cannot be answered with', async () => {
		const redirected = { ok: true, status: 200, redirected: true, clone: vi.fn() };
		const sw = loadFetchHandler(vi.fn(async () => redirected));

		expect(await sw.navigate('/reminders/')).toBe(redirected);

		expect(sw.cache.put).not.toHaveBeenCalled();
		expect(redirected.clone).not.toHaveBeenCalled();
	});
});
