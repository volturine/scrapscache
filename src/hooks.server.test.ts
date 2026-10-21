import type { RequestEvent } from '@sveltejs/kit';
import type { ResolveOptions } from '@sveltejs/kit/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYNC_DELTA_PATH } from '#lib/model/protocol.js';
import { privateEnv, publicEnv } from './tests/env';

vi.mock('#lib/server/metrics.js', () => ({
	recordHttpRequest: vi.fn(),
	routeLabel: (pathname: string) => pathname
}));

import { handle } from './hooks.server';
import { addDatabaseCost, nameRequestCost } from '#lib/server/requestCost.js';

function respond(requestHeaders: Record<string, string> = {}): Promise<Response> {
	return (handle as unknown as (input: unknown) => Promise<Response>)({
		event: {
			request: new Request(new URL(SYNC_DELTA_PATH, 'https://example.test'), {
				headers: requestHeaders
			}),
			url: new URL(SYNC_DELTA_PATH, 'https://example.test')
		},
		resolve: async () => new Response('ok', { status: 200 })
	});
}

describe('security headers', () => {
	it('sends HSTS for the host that answered, without claiming the whole zone', async () => {
		const response = await respond();
		expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000');
	});

	it('keeps the framing, sniffing and referrer protections', async () => {
		const response = await respond();
		expect(response.headers.get('x-frame-options')).toBe('DENY');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('referrer-policy')).toBe('no-referrer');
		expect(response.headers.get('permissions-policy')).toContain('geolocation=()');
		expect(response.headers.get('permissions-policy')).toContain('camera=(self)');
	});

	it('isolates the app from other sites’ windows and subresource loads', async () => {
		const response = await respond();
		expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
		expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
	});

	it('keeps the opener for the MCP authorize page, which an OAuth popup chain passes through', async () => {
		const response = await visit('https://example.test/mcp/authorize?session_id=x', page());
		expect(response.headers.get('cross-origin-opener-policy')).toBeNull();
		expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
		expect(
			(await visit('https://example.test/mcp/authorize/other', page())).headers.get(
				'cross-origin-opener-policy'
			)
		).toBe('same-origin');
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
					headers: {
						'content-type': 'text/html; charset=utf-8',
						'cache-control': 'private'
					}
				})
		);

		const api = await visit(
			'https://example.test/api/status',
			() =>
				new Response('{}', {
					headers: {
						'content-type': 'application/json',
						'cache-control': 'no-store'
					}
				})
		);

		expect(html.headers.get('cache-control')).toBe('private, no-transform');
		expect(api.headers.get('cache-control')).toBe('no-store');
	});

	it('keeps HTML shells out of shared caches when the resolver sets no policy', async () => {
		const response = await visit(
			'https://example.test/',
			() => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
		);

		expect(response.headers.get('cache-control')).toBe('private, no-transform');
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
		for (const key of Object.keys(privateEnv)) delete privateEnv[key];
		for (const key of Object.keys(publicEnv)) delete publicEnv[key];
	});

	function configure() {
		publicEnv.PUBLIC_TURNSTILE_ORIGIN = CHALLENGE;
		privateEnv.TURNSTILE_SITEKEY = 'sitekey';
		privateEnv.SCRAPSCACHE_ORIGIN = APP;
	}

	it('serves nothing but the challenge page, so the app never runs there', async () => {
		configure();
		const resolved = vi.fn(page());

		const response = await visit(`${CHALLENGE}/`, resolved);

		expect(response.status).toBe(404);
		expect(resolved).not.toHaveBeenCalled();
		expect((await visit(`${CHALLENGE}${SYNC_DELTA_PATH}`, resolved)).status).toBe(404);
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
					transformedHtml = (await opts.transformPageChunk({ html: sampleHtml, done: true })) ?? '';
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

	it('keeps one title and description: the page its own, else the app defaults', async () => {
		const shell = (head: string) => `<head>
			<!-- page-meta: defaults -->
			<title>Scraps Cache</title>
			<meta name="description" content="Default" />
			<!-- /page-meta -->
			${head}
		</head>`;
		const render = async (html: string) => {
			let transformed = '';
			await handle({
				event: {
					request: new Request('https://example.test/privacy'),
					url: new URL('https://example.test/privacy'),
					locals: {}
				} as unknown as RequestEvent,
				resolve: async (_event: RequestEvent, opts?: ResolveOptions) => {
					transformed = (await opts?.transformPageChunk?.({ html, done: true })) ?? '';
					return new Response(transformed, { headers: { 'Content-Type': 'text/html' } });
				}
			});
			return transformed;
		};

		const page = await render(
			shell('<title>Privacy</title><meta name="description" content="Own"/>')
		);
		expect(page.match(/<title>/g)).toHaveLength(1);
		expect(page.match(/name="description"/g)).toHaveLength(1);
		expect(page).toContain('content="Own"');

		const app = await render(shell(''));
		expect(app).toContain('<title>Scraps Cache</title>');
		expect(app).toContain('content="Default"');
	});
});

describe('request logs', () => {
	afterEach(() => vi.restoreAllMocks());

	const logged = (info: { mock: { calls: unknown[][] } }) =>
		info.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);

	it('logs one refusal in a hundred, saying so, and every other client error', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
		await visit(
			`https://example.test${SYNC_DELTA_PATH}`,
			() => new Response(null, { status: 429 })
		);
		await visit(
			`https://example.test${SYNC_DELTA_PATH}`,
			() => new Response(null, { status: 401 })
		);
		random.mockReturnValue(0.001);
		await visit(
			`https://example.test${SYNC_DELTA_PATH}`,
			() => new Response(null, { status: 429 })
		);

		expect(logged(info).map(({ status, sampleRate }) => [status, sampleRate])).toEqual([
			[401, undefined],
			[429, 0.01]
		]);
	});

	it('logs a sampled request’s database cost by route and kind, and nothing that names the account', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		vi.spyOn(Math, 'random').mockReturnValue(0);
		await visit(`https://example.test${SYNC_DELTA_PATH}`, () => {
			addDatabaseCost({ queries: 3, rowsRead: 14, rowsWritten: 2 });
			nameRequestCost('empty');
			return new Response('ok');
		});

		expect(logged(info)).toEqual([
			{
				level: 'info',
				event: 'request_cost',
				route: SYNC_DELTA_PATH,
				method: 'GET',
				kind: 'empty',
				status: 200,
				queries: 3,
				rowsRead: 14,
				rowsWritten: 2,
				sampleRate: 0.01
			}
		]);
	});

	it('logs no cost for a request that did not touch the database', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		vi.spyOn(Math, 'random').mockReturnValue(0);
		await visit(`https://example.test${SYNC_DELTA_PATH}`, () => new Response('ok'));
		expect(info).not.toHaveBeenCalled();
	});
});
