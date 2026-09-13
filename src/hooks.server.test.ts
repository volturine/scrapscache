import { describe, it, expect, vi } from 'vitest';
import { handle } from './hooks.server';
import type { RequestEvent, ResolveOptions } from '@sveltejs/kit';

describe('hooks.server handle', () => {
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
