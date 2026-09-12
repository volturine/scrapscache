import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/metrics', () => ({ recordHttpRequest: vi.fn() }));

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
});
