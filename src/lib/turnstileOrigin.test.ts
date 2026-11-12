import { beforeEach, describe, expect, it, vi } from 'vitest';

const isNativeApp = vi.hoisted(() => vi.fn(() => false));
vi.mock('#lib/native.js', () => ({ isNativeApp }));

import { loadTurnstileNeed } from './turnstileOrigin';
import { serverSetting } from './serverOrigin.svelte';

const answer = (body: unknown, status = 200) =>
	vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch;

beforeEach(() => isNativeApp.mockReturnValue(false));

describe('what the sync server asks for before registering', () => {
	it('is asked of the page’s own server on the web', async () => {
		const fetchImpl = answer({ turnstileOrigin: 'https://verify.scrapscache.com' });

		expect(await loadTurnstileNeed(fetchImpl)).toEqual({
			kind: 'check',
			origin: 'https://verify.scrapscache.com'
		});
		expect(vi.mocked(fetchImpl).mock.calls[0][0]).toBe('/api/sync/register');
	});

	it('is asked of the server the iPhone app is set to', async () => {
		isNativeApp.mockReturnValue(true);
		const fetchImpl = answer({ turnstileOrigin: 'https://verify.scrapscache.com' });

		expect(await loadTurnstileNeed(fetchImpl)).toEqual({
			kind: 'check',
			origin: 'https://verify.scrapscache.com'
		});
		expect(vi.mocked(fetchImpl).mock.calls[0][0]).toBe(`${serverSetting.origin}/api/sync/register`);
	});

	it('is a check the iPhone app cannot open when its origin is not a hosted one', async () => {
		isNativeApp.mockReturnValue(true);

		expect(
			await loadTurnstileNeed(answer({ turnstileOrigin: 'https://verify.self-hosted.example' }))
		).toEqual({ kind: 'unsupported', origin: 'https://verify.self-hosted.example' });
	});

	it('is none only when the server says so', async () => {
		expect(await loadTurnstileNeed(answer({ turnstileOrigin: null }))).toEqual({ kind: 'none' });
	});

	it('is unknown when the server cannot be asked, not "no check"', async () => {
		const offline = vi.fn(async () => {
			throw new TypeError('Load failed');
		}) as unknown as typeof fetch;

		expect(await loadTurnstileNeed(offline)).toEqual({ kind: 'unknown' });
		expect(await loadTurnstileNeed(answer({ error: 'Unavailable' }, 503))).toEqual({
			kind: 'unknown'
		});
		expect(await loadTurnstileNeed(answer({}))).toEqual({ kind: 'unknown' });
	});

	it('gives up on a server that does not answer', async () => {
		const hanging = vi.fn(
			(_url: RequestInfo | URL, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) =>
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
				)
		) as unknown as typeof fetch;

		expect(await loadTurnstileNeed(hanging, 10)).toEqual({ kind: 'unknown' });
	});

	it('takes an http(s) origin as browsers write it, and nothing else', async () => {
		expect(
			await loadTurnstileNeed(answer({ turnstileOrigin: 'https://Verify.ScrapsCache.com:443' }))
		).toEqual({ kind: 'check', origin: 'https://verify.scrapscache.com' });
		for (const value of [
			'https://verify.scrapscache.com/turnstile',
			'https://verify.scrapscache.com/?a=1',
			'https://user@verify.scrapscache.com',
			'javascript:alert(1)',
			'capacitor://localhost',
			'verify.scrapscache.com',
			42
		])
			expect(await loadTurnstileNeed(answer({ turnstileOrigin: value })), String(value)).toEqual({
				kind: 'unknown'
			});
	});
});
