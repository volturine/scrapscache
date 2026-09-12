import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
	private: {} as Record<string, string | undefined>,
	public: {} as Record<string, string | undefined>
}));
vi.mock('$env/dynamic/private', () => ({ env: env.private }));
vi.mock('$env/dynamic/public', () => ({ env: env.public }));

import { verifyTurnstile } from './turnstile';

const fetchMock = vi.fn();

function siteverify(body: unknown, status = 200) {
	fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

describe('verifyTurnstile', () => {
	beforeEach(() => {
		env.public.PUBLIC_TURNSTILE_SITEKEY = 'sitekey';
		env.private.TURNSTILE_SECRET = 'secret';
		env.private.TURNSTILE_HOSTNAMES = 'scrapscache.com, dev.scrapscache.com';
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		for (const key of Object.keys(env.private)) delete env.private[key];
		for (const key of Object.keys(env.public)) delete env.public[key];
	});

	it('is disabled only when every setting is unset', async () => {
		delete env.public.PUBLIC_TURNSTILE_SITEKEY;
		delete env.private.TURNSTILE_SECRET;
		delete env.private.TURNSTILE_HOSTNAMES;
		expect(await verifyTurnstile(undefined, 'register', '203.0.113.1')).toBe('disabled');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each(['PUBLIC_TURNSTILE_SITEKEY', 'TURNSTILE_SECRET', 'TURNSTILE_HOSTNAMES'])(
		'fails closed when %s is missing',
		async (missing) => {
			delete env.public[missing];
			delete env.private[missing];
			expect(await verifyTurnstile('token', 'register', '203.0.113.1')).toBe('misconfigured');
			expect(fetchMock).not.toHaveBeenCalled();
		}
	);

	it.each([undefined, '', 42, 'x'.repeat(2049)])(
		'rejects a missing or malformed token without calling siteverify',
		async (token) => {
			expect(await verifyTurnstile(token, 'register', '203.0.113.1')).toBe('rejected');
			expect(fetchMock).not.toHaveBeenCalled();
		}
	);

	it('verifies a successful token for the expected action and hostname', async () => {
		siteverify({ success: true, action: 'register', hostname: 'dev.scrapscache.com' });

		expect(await verifyTurnstile('token', 'register', '203.0.113.1')).toBe('verified');

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
		const body = init.body as URLSearchParams;
		expect(body.get('secret')).toBe('secret');
		expect(body.get('response')).toBe('token');
		expect(body.get('remoteip')).toBe('203.0.113.1');
	});

	it('omits an unknown client address', async () => {
		siteverify({ success: true, action: 'register', hostname: 'scrapscache.com' });
		await verifyTurnstile('token', 'register', 'unknown');
		const body = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as URLSearchParams;
		expect(body.has('remoteip')).toBe(false);
	});

	it.each([
		{ success: false, action: 'register', hostname: 'scrapscache.com' },
		{ success: true, action: 'login', hostname: 'scrapscache.com' },
		{ success: true, action: 'register', hostname: 'localhost' },
		{ success: true, action: 'register' }
	])('rejects siteverify result %j', async (result) => {
		siteverify(result);
		expect(await verifyTurnstile('token', 'register', '203.0.113.1')).toBe('rejected');
	});

	it('rejects when siteverify errors or is unreachable', async () => {
		siteverify({ success: true, action: 'register', hostname: 'scrapscache.com' }, 500);
		expect(await verifyTurnstile('token', 'register', '203.0.113.1')).toBe('rejected');
		fetchMock.mockRejectedValueOnce(new Error('network down'));
		expect(await verifyTurnstile('token', 'register', '203.0.113.1')).toBe('rejected');
	});
});
