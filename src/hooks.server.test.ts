import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
	private: {} as Record<string, string | undefined>,
	public: {} as Record<string, string | undefined>
}));
vi.mock('$lib/server/metrics', () => ({ recordHttpRequest: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: env.private }));
vi.mock('$env/dynamic/public', () => ({ env: env.public }));

import type { RequestEvent, ResolveOptions } from '@sveltejs/kit';
import { handle } from './hooks.server';

function respond(requestHeaders: Record<string, string> = {}): Promise<Response> {
	return (handle as unknown as (input: unknown) => Promise<Response>)({
		event: {
			request: new Request('https://example.test/api/sync/delta', { headers: requestHeaders }),
			url: new URL('https://example.test/api/sync/delta')
		},
		resolve: async () => new Response('ok', { status: 200 })
	});
}

describe('security headers', () => {
	it('covers subdomains with HSTS so preview origins cannot be downgraded', async () => {
		const response = await respond();
		expect(response.headers.get('strict-transport-security')).toBe(
			'max-age=31536000; includeSubDomains'
		);
	});

	it('keeps the framing, sniffing and referrer protections', async () => {
		const response = await respond();
		expect(response.headers.get('x-frame-options')).toBe('DENY');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('referrer-policy')).toBe('no-referrer');
		expect(response.headers.get('permissions-policy')).toContain('geolocation=()');
	});

	it('echoes a well-formed request id and replaces a malformed one', async () => {
		const echoed = await respond({ 'x-request-id': 'abc-123_XYZ.1' });
		expect(echoed.headers.get('x-request-id')).toBe('abc-123_XYZ.1');

		const rejected = await respond({ 'x-request-id': 'bad id with junk' });
		expect(rejected.headers.get('x-request-id')).not.toBe('bad id with junk');
		expect(rejected.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('prevents Cloudflare from injecting JavaScript into HTML responses', async () => {
		const html = await visit(
			'https://example.test/',
			() =>
				new Response('<html></html>', {
					headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private' }
				})
		);
		const api = await visit(
			'https://example.test/api/status',
			() =>
				new Response('{}', {
					headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
				})
		);

		expect(html.headers.get('cache-control')).toBe('private, no-transform');
		expect(api.headers.get('cache-control')).toBe('no-store');
	});
});

const APP = 'https://scrapscache.com';
const CHALLENGE = 'https://verify.scrapscache.com';
const APP_POLICY =
	"default-src 'self'; script-src 'self' 'nonce-a'; frame-src 'self' blob:; frame-ancestors 'none'";

function visit(url: string, served: () => Response): Promise<Response> {
	return (handle as unknown as (input: unknown) => Promise<Response>)({
		event: { request: new Request(url), url: new URL(url) },
		resolve: async () => served()
	});
}

function page(policy = APP_POLICY) {
	return () => new Response('<html></html>', { headers: { 'content-security-policy': policy } });
}

describe('the Turnstile challenge origin', () => {
	afterEach(() => {
		for (const key of Object.keys(env.private)) delete env.private[key];
		for (const key of Object.keys(env.public)) delete env.public[key];
	});

	function configure() {
		env.public.PUBLIC_TURNSTILE_ORIGIN = CHALLENGE;
		env.private.TURNSTILE_SITEKEY = 'sitekey';
		env.private.SCRAPSCACHE_ORIGIN = APP;
	}

	it('serves nothing but the challenge page, so the app never runs there', async () => {
		configure();
		const resolved = vi.fn(page());

		const response = await visit(`${CHALLENGE}/`, resolved);

		expect(response.status).toBe(404);
		expect(resolved).not.toHaveBeenCalled();
		expect((await visit(`${CHALLENGE}/api/sync/delta`, resolved)).status).toBe(404);
	});

	it('lets the challenge page be framed by the app it names', async () => {
		configure();
		const response = await visit(
			`${CHALLENGE}/turnstile?action=register`,
			page(`default-src 'none'; frame-ancestors ${APP}`)
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('x-frame-options')).toBeNull();
	});

	it('still refuses framing for everything that says frame-ancestors none, or says nothing', async () => {
		configure();
		expect((await visit(`${APP}/`, page())).headers.get('x-frame-options')).toBe('DENY');
		expect(
			(await visit(`${APP}/api/x`, () => new Response('ok'))).headers.get('x-frame-options')
		).toBe('DENY');
	});

	it('lets the app frame the challenge origin, and adds nothing to its script policy', async () => {
		configure();
		const policy = (await visit(`${APP}/`, page())).headers.get('content-security-policy') ?? '';

		expect(policy).toContain(`frame-src 'self' blob: ${CHALLENGE}`);
		expect(policy).toContain("script-src 'self' 'nonce-a';");
		expect(policy).not.toMatch(/script-src[^;]*verify\.scrapscache\.com/);
	});

	it('leaves the app policy alone when Turnstile is not configured', async () => {
		const policy = (await visit(`${APP}/`, page())).headers.get('content-security-policy');
		expect(policy).toBe(APP_POLICY);
	});
});

describe('link previews', () => {
	it('injects dynamic request origin and canonical URL for social link previews', async () => {
		const sampleHtml = `
			<meta property="og:image" content="https://scrapscache.com/og-preview.png" />
			<meta property="og:url" content="https://scrapscache.com/" />
			<meta name="twitter:image" content="https://scrapscache.com/og-preview.png" />
		`;

		let transformedHtml = '';
		const mockResolve = vi
			.fn()
			.mockImplementation(async (_event: RequestEvent, opts?: ResolveOptions) => {
				if (opts?.transformPageChunk) {
					transformedHtml =
						(await opts.transformPageChunk({
							html: sampleHtml,
							done: true
						})) ?? '';
				}
				return new Response(transformedHtml, {
					status: 200,
					headers: { 'Content-Type': 'text/html' }
				});
			});

		const event = {
			request: new Request('https://dev.scrapscache.com/privacy'),
			url: new URL('https://dev.scrapscache.com/privacy'),
			locals: {}
		} as unknown as RequestEvent;

		const response = await handle({ event, resolve: mockResolve });

		expect(response.status).toBe(200);
		expect(response.headers.get('x-frame-options')).toBe('DENY');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('x-request-id')).toBeTruthy();

		// Origin must match dev.scrapscache.com, not hardcoded scrapscache.com
		expect(transformedHtml).toContain(
			'<meta property="og:image" content="https://dev.scrapscache.com/og-preview.png" />'
		);
		expect(transformedHtml).toContain(
			'<meta property="og:url" content="https://dev.scrapscache.com/privacy" />'
		);
		expect(transformedHtml).toContain(
			'<meta name="twitter:image" content="https://dev.scrapscache.com/og-preview.png" />'
		);
	});
});
