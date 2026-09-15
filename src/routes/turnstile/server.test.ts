import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
	private: {} as Record<string, string | undefined>,
	public: {} as Record<string, string | undefined>
}));
vi.mock('$env/dynamic/private', () => ({ env: env.private }));
vi.mock('$env/dynamic/public', () => ({ env: env.public }));

import { GET } from './+server';

const CHALLENGE = 'https://verify.scrapscache.com';
const APP = 'https://scrapscache.com';

function get(url: string): Response {
	return (GET as unknown as (event: { url: URL }) => Response)({ url: new URL(url) });
}

function directives(response: Response): Map<string, string> {
	return new Map(
		(response.headers.get('content-security-policy') ?? '')
			.split(';')
			.map((part) => part.trim())
			.filter(Boolean)
			.map((part) => {
				const [name, ...values] = part.split(' ');
				return [name, values.join(' ')] as [string, string];
			})
	);
}

beforeEach(() => {
	env.public.PUBLIC_TURNSTILE_ORIGIN = CHALLENGE;
	env.private.TURNSTILE_SITEKEY = 'sitekey-1';
	env.private.SCRAPSCACHE_ORIGIN = APP;
});

afterEach(() => {
	for (const key of Object.keys(env.private)) delete env.private[key];
	for (const key of Object.keys(env.public)) delete env.public[key];
});

describe('the Turnstile challenge page', () => {
	it('is served on the challenge origin', async () => {
		const response = get(`${CHALLENGE}/turnstile?action=register`);

		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('https://challenges.cloudflare.com/turnstile/v0/api.js');
		expect(html).toContain('"sitekey-1"');
		expect(html).toContain('"register"');
	});

	it('is never served on the app origin, where its script could read the keys', () => {
		expect(get(`${APP}/turnstile?action=register`).status).toBe(404);
	});

	it('does not exist when Turnstile is not configured', () => {
		delete env.public.PUBLIC_TURNSTILE_ORIGIN;
		expect(get(`${CHALLENGE}/turnstile?action=register`).status).toBe(404);
	});

	it('does not exist when configured onto the app origin', () => {
		env.public.PUBLIC_TURNSTILE_ORIGIN = APP;
		expect(get(`${APP}/turnstile?action=register`).status).toBe(404);
	});

	it('issues tokens only for actions the server checks', () => {
		expect(get(`${CHALLENGE}/turnstile?action=login`).status).toBe(400);
		expect(get(`${CHALLENGE}/turnstile`).status).toBe(400);
	});

	it('can be framed only by the app, and sends its token only to the app', async () => {
		const response = get(`${CHALLENGE}/turnstile?action=register`);

		expect(directives(response).get('frame-ancestors')).toBe(APP);
		expect(await response.text()).toContain(`var appOrigin = "${APP}"`);
	});

	it('runs only its own nonce and Turnstile, and loads nothing else', async () => {
		const response = get(`${CHALLENGE}/turnstile?action=register`);
		const policy = directives(response);
		const nonce = /'nonce-([^']+)'/.exec(policy.get('script-src') ?? '')?.[1];

		expect(policy.get('default-src')).toBe("'none'");
		expect(policy.get('script-src')).toBe(`'nonce-${nonce}' https://challenges.cloudflare.com`);
		const html = await response.text();
		// Parsed rather than pattern-matched, so it counts scripts the way a browser would.
		const scripts = [
			...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('script')
		];
		expect(scripts).toHaveLength(2);
		for (const script of scripts) expect(script.getAttribute('nonce')).toBe(nonce);
	});

	it('uses a fresh nonce for every page', () => {
		const first = directives(get(`${CHALLENGE}/turnstile?action=register`)).get('script-src');
		const second = directives(get(`${CHALLENGE}/turnstile?action=register`)).get('script-src');
		expect(first).not.toBe(second);
	});

	it('cannot be broken out of by a configured value', async () => {
		env.private.TURNSTILE_SITEKEY = '</script><script>steal()</script>';
		const html = await get(`${CHALLENGE}/turnstile?action=register`).text();

		expect(html).not.toContain('</script><script>steal()');
		expect(html).toContain('\\u003c/script>');
	});

	it('is not cached', () => {
		expect(get(`${CHALLENGE}/turnstile?action=register`).headers.get('cache-control')).toBe(
			'no-store'
		);
	});
});
