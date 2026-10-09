/**
 * The offline copy of a build: precached whole on install, the only cache left
 * once it activates, and answering a navigation the network is slow to answer.
 * A navigation answered with an error page, or with a redirect, must not
 * become what the app shows offline.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheName, NAVIGATION_TIMEOUT_MS, startServiceWorker, type Build } from './worker';

const ORIGIN = 'https://scrapscache.example';
const BUILD: Build = {
	version: 'abc123',
	precache: ['/', '/_app/immutable/entry/start.1a2b.js', '/manifest.json']
};

type Listener = (event: unknown) => void;

/** Caches keyed by name, each holding responses by path. */
function fakeCaches(seed: Record<string, Record<string, Response>> = {}) {
	const stores = new Map<string, Map<string, Response>>();
	const keyOf = (request: string | { url: string }) =>
		new URL(typeof request === 'string' ? request : request.url, ORIGIN).pathname;
	const open = (name: string) => {
		let store = stores.get(name);
		if (!store) stores.set(name, (store = new Map()));
		const entries = store;
		return {
			match: async (request: string | { url: string }) => entries.get(keyOf(request))?.clone(),
			put: vi.fn(async (request: string | { url: string }, response: Response) => {
				entries.set(keyOf(request), response);
			})
		};
	};
	for (const [name, entries] of Object.entries(seed)) {
		const cache = open(name);
		for (const [path, response] of Object.entries(entries)) void cache.put(path, response);
	}
	return {
		stores,
		open: vi.fn(async (name: string) => open(name)),
		keys: async () => [...stores.keys()],
		delete: vi.fn(async (name: string) => stores.delete(name)),
		match: async (request: string | { url: string }) => {
			for (const store of stores.values()) {
				const found = store.get(keyOf(request));
				if (found) return found.clone();
			}
			return undefined;
		}
	};
}

function loadWorker(fetch: ReturnType<typeof vi.fn>, caches = fakeCaches(), scope = `${ORIGIN}/`) {
	const listeners = new Map<string, Listener>();
	const sw = {
		location: { origin: ORIGIN },
		registration: { showNotification: vi.fn(), scope },
		clients: { claim: vi.fn(async () => undefined) },
		caches,
		fetch,
		addEventListener(type: string, listener: Listener) {
			listeners.set(type, listener);
		},
		skipWaiting: vi.fn(async () => undefined)
	};
	startServiceWorker(sw as unknown as ServiceWorkerGlobalScope, BUILD);
	const lifecycle = async (type: 'install' | 'activate') => {
		let completion: Promise<unknown> = Promise.resolve();
		listeners.get(type)!({ waitUntil: (promise: Promise<unknown>) => (completion = promise) });
		await completion;
	};
	return {
		caches,
		install: () => lifecycle('install'),
		activate: () => lifecycle('activate'),
		navigate(path = '/') {
			const pending: Promise<unknown>[] = [];
			let answered: Promise<unknown> | null = null;
			listeners.get('fetch')!({
				request: { method: 'GET', url: `${ORIGIN}${path}`, mode: 'navigate' },
				respondWith(promise: Promise<unknown>) {
					answered = promise;
				},
				waitUntil(promise: Promise<unknown>) {
					pending.push(promise);
				}
			});
			return {
				response: answered! as Promise<Response>,
				// The network side, which may finish after the page was answered.
				settled: async () => {
					await Promise.all(pending);
					await new Promise((resolve) => setTimeout(resolve, 0));
				}
			};
		}
	};
}

const page = (body: string) => new Response(body, { status: 200 });

afterEach(() => {
	vi.useRealTimers();
});

describe('installing a build', () => {
	it("precaches every file of the build into the build's own cache", async () => {
		const fetch = vi.fn(async (path: string) => page(path));
		const sw = loadWorker(fetch);

		await sw.install();

		const cached = sw.caches.stores.get(cacheName(BUILD))!;
		expect([...cached.keys()].sort()).toEqual([...BUILD.precache].sort());
		expect(fetch).toHaveBeenCalledTimes(BUILD.precache.length);
	});

	it('takes an unchanged hashed file from the build before instead of downloading it', async () => {
		const caches = fakeCaches({
			'scrapscache-older': { '/_app/immutable/entry/start.1a2b.js': page('kept') }
		});
		const fetch = vi.fn(async (path: string) => page(path));
		const sw = loadWorker(fetch, caches);

		await sw.install();

		expect(fetch.mock.calls.map(([path]) => path).sort()).toEqual(['/', '/manifest.json']);
		const kept = await sw.caches.stores
			.get(cacheName(BUILD))!
			.get('/_app/immutable/entry/start.1a2b.js')!
			.text();
		expect(kept).toBe('kept');
	});

	it('fails the install rather than activate a build it could not copy whole', async () => {
		const fetch = vi.fn(async (path: string) =>
			path === '/manifest.json' ? new Response('gone', { status: 404 }) : page(path)
		);
		const sw = loadWorker(fetch);

		await expect(sw.install()).rejects.toThrow('Could not precache /manifest.json');
	});

	it('drops every earlier cache once it activates', async () => {
		const caches = fakeCaches({
			'scrapscache-v4': { '/_app/immutable/old.js': page('old') },
			'scrapscache-older': { '/': page('old shell') },
			[cacheName(BUILD)]: { '/': page('shell') }
		});
		const sw = loadWorker(vi.fn(), caches);

		await sw.activate();

		expect([...caches.stores.keys()]).toEqual([cacheName(BUILD)]);
	});

	it('names a new cache for new files even when the version name is the same', () => {
		expect(cacheName({ version: 'unversioned', precache: ['/', '/_app/immutable/a.js'] })).not.toBe(
			cacheName({ version: 'unversioned', precache: ['/', '/_app/immutable/b.js'] })
		);
	});

	it("leaves the app's cache alone when installed for a workspace's push", async () => {
		const caches = fakeCaches();
		const sw = loadWorker(vi.fn(), caches, `${ORIGIN}/push/home/`);

		await sw.install();
		await sw.activate();

		expect(caches.open).not.toHaveBeenCalled();
		expect(caches.delete).not.toHaveBeenCalled();
	});
});

describe('navigations', () => {
	it('caches a good page as the shell', async () => {
		const fresh = page('<!doctype html>');
		const sw = loadWorker(vi.fn(async () => fresh));

		const navigation = sw.navigate('/');
		expect(await navigation.response).toBe(fresh);
		await navigation.settled();

		expect(await sw.caches.stores.get(cacheName(BUILD))!.get('/')!.text()).toBe('<!doctype html>');
	});

	it('does not cache an error page as the shell', async () => {
		const outage = new Response('Service Unavailable', { status: 503 });
		const sw = loadWorker(vi.fn(async () => outage));

		const navigation = sw.navigate('/');
		expect(await navigation.response).toBe(outage);
		await navigation.settled();

		expect(sw.caches.stores.get(cacheName(BUILD))?.has('/')).toBeFalsy();
	});

	it('does not cache a redirected page, which a navigation cannot be answered with', async () => {
		const redirected = { ok: true, status: 200, redirected: true, clone: vi.fn() };
		const sw = loadWorker(vi.fn(async () => redirected));

		const navigation = sw.navigate('/reminders/');
		expect(await navigation.response).toBe(redirected);
		await navigation.settled();

		expect(redirected.clone).not.toHaveBeenCalled();
	});

	it('answers from the cached shell when offline', async () => {
		const caches = fakeCaches({ [cacheName(BUILD)]: { '/': page('cached shell') } });
		const sw = loadWorker(
			vi.fn(async () => {
				throw new TypeError('offline');
			}),
			caches
		);

		expect(await (await sw.navigate('/reminders').response).text()).toBe('cached shell');
	});

	it('answers from the cached shell when the network is slow, and still refreshes it', async () => {
		vi.useFakeTimers();
		const caches = fakeCaches({ [cacheName(BUILD)]: { '/': page('cached shell') } });
		let answer: (response: Response) => void = () => undefined;
		const sw = loadWorker(
			vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
			caches
		);

		const navigation = sw.navigate('/');
		await vi.advanceTimersByTimeAsync(NAVIGATION_TIMEOUT_MS);
		expect(await (await navigation.response).text()).toBe('cached shell');

		answer(page('fresh shell'));
		vi.useRealTimers();
		await navigation.settled();
		expect(await caches.stores.get(cacheName(BUILD))!.get('/')!.text()).toBe('fresh shell');
	});

	it('waits for the network when nothing is cached yet', async () => {
		vi.useFakeTimers();
		let answer: (response: Response) => void = () => undefined;
		const sw = loadWorker(vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));

		const navigation = sw.navigate('/');
		await vi.advanceTimersByTimeAsync(NAVIGATION_TIMEOUT_MS * 2);
		const fresh = page('first visit');
		answer(fresh);

		expect(await navigation.response).toBe(fresh);
	});
});
