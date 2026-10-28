import { describe, expect, it } from 'vitest';
import { allowAppOrigin, appOrigin, preflightResponse } from './appCors';

const APP = 'capacitor://localhost';

function request(init: RequestInit & { origin?: string } = {}): Request {
	const headers = new Headers(init.headers);
	if (init.origin) headers.set('origin', init.origin);
	return new Request('https://relay.test/api/sync/pair/start', { ...init, headers });
}

describe('appOrigin', () => {
	it('is the app’s origin on the sync API, and nothing else', () => {
		expect(appOrigin(request({ origin: APP }), '/api/sync/pair/start')).toBe(APP);
		expect(appOrigin(request({ origin: APP }), '/api/admin/status')).toBeNull();
		expect(appOrigin(request({ origin: APP }), '/')).toBeNull();
		expect(appOrigin(request({ origin: 'https://evil.test' }), '/api/sync/pair/start')).toBeNull();
		expect(appOrigin(request({ origin: 'capacitor://localhost:1' }), '/api/sync/x')).toBeNull();
		expect(appOrigin(request(), '/api/sync/pair/start')).toBeNull();
	});
});

describe('preflightResponse', () => {
	it('answers the app’s preflight with the sync API’s methods and headers, no credentials', () => {
		const response = preflightResponse(
			request({
				method: 'OPTIONS',
				origin: APP,
				headers: {
					'access-control-request-method': 'POST',
					'access-control-request-headers': 'authorization, content-type'
				}
			}),
			'/api/sync/pair/start'
		);
		expect(response?.status).toBe(204);
		expect(response?.headers.get('access-control-allow-origin')).toBe(APP);
		expect(response?.headers.get('access-control-allow-methods')).toBe('GET, POST, PUT, DELETE');
		expect(response?.headers.get('access-control-allow-headers')).toContain('authorization');
		expect(response?.headers.get('access-control-allow-headers')).toContain('x-sync-client-id');
		expect(response?.headers.get('access-control-allow-headers')).toContain(
			'x-scrapscache-sync-version'
		);
		expect(response?.headers.get('access-control-allow-credentials')).toBeNull();
		expect(response?.headers.get('vary')).toBe('Origin');
	});

	it('leaves every other request to the routes', () => {
		const preflightHeaders = { 'access-control-request-method': 'POST' };
		expect(
			preflightResponse(
				request({ method: 'OPTIONS', origin: 'https://evil.test', headers: preflightHeaders }),
				'/api/sync/pair/start'
			)
		).toBeNull();
		expect(
			preflightResponse(
				request({ method: 'OPTIONS', origin: APP, headers: preflightHeaders }),
				'/api/admin/status'
			)
		).toBeNull();
		expect(
			preflightResponse(request({ method: 'OPTIONS', origin: APP }), '/api/sync/x')
		).toBeNull();
		expect(
			preflightResponse(
				request({ method: 'POST', origin: APP, headers: preflightHeaders }),
				'/api/sync/pair/start'
			)
		).toBeNull();
	});
});

describe('allowAppOrigin', () => {
	it('names the origin, exposes the request id and varies on Origin', () => {
		const headers = new Headers({ vary: 'Accept' });
		allowAppOrigin(headers, APP);
		expect(headers.get('access-control-allow-origin')).toBe(APP);
		expect(headers.get('access-control-expose-headers')).toBe('x-request-id');
		expect(headers.get('vary')).toBe('Accept, Origin');
	});
});
