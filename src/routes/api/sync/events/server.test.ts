import { describe, expect, it, vi } from 'vitest';

const VALID_TOKEN = vi.hoisted(() => 'a'.repeat(43));
const mocks = vi.hoisted(() => ({
	authenticate: vi.fn((): string | null => 'account-123456789'),
	authenticateToken: vi.fn(
		async (token: string): Promise<{ accountId: string; expiresAt: number } | null> =>
			token === VALID_TOKEN ? { accountId: 'account-123456789', expiresAt: 9_000 } : null
	),
	createEventSocket: vi.fn(async () => new Response(null, { status: 200 })),
	createEventStream: vi.fn((_accountId: string, _signal?: AbortSignal) => {
		return new Response(': ok\n\n', {
			headers: { 'Content-Type': 'text/event-stream' }
		});
	}),
	limitChecks: vi.fn<(key: string) => { allowed: boolean; retryAfterSeconds?: number }>(() => ({
		allowed: true
	}))
}));

vi.mock('#lib/server/syncStore.js', () => ({
	getSyncStore: () => ({
		createEventStream: mocks.createEventStream,
		createEventSocket: mocks.createEventSocket
	})
}));

vi.mock('#lib/server/syncAuth.js', () => ({
	getSyncAuth: () => ({
		authenticateSyncRequest: mocks.authenticate,
		authenticateSyncToken: mocks.authenticateToken
	})
}));

vi.mock('#lib/server/rateLimit.js', () => ({
	clientAddress: () => '127.0.0.1',
	getPublicApiLimiter: () => ({ check: (key: string) => mocks.limitChecks(key) }),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));

import { GET } from './+server';

async function get(clientId?: string): Promise<Response> {
	const url = new URL('http://localhost/api/sync/events');
	if (clientId) url.searchParams.set('clientId', clientId);
	return (
		GET as unknown as (event: {
			request: Request;
			url: URL;
			getClientAddress(): string;
		}) => Promise<Response>
	)({
		request: new Request(url, { headers: { authorization: 'Bearer valid-session' } }),
		url,
		getClientAddress: () => '127.0.0.1'
	});
}

describe('GET /api/sync/events', () => {
	it('returns event stream response for authenticated requests', async () => {
		mocks.authenticate.mockReturnValueOnce('account-123456789');
		const res = await get();
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/event-stream');
		expect(mocks.createEventStream).toHaveBeenCalledWith(
			'account-123456789',
			expect.any(Object),
			undefined
		);
	});

	it('forwards the client id so the stream can suppress self-echo', async () => {
		mocks.authenticate.mockReturnValueOnce('account-123456789');
		await get('device-abc');
		expect(mocks.createEventStream).toHaveBeenCalledWith(
			'account-123456789',
			expect.any(Object),
			'device-abc'
		);
	});

	it('rejects unauthenticated requests with 401', async () => {
		mocks.authenticate.mockReturnValueOnce(null);
		const res = await get();
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: 'Invalid sync session' });
	});

	it('rate limits excessive connections', async () => {
		mocks.limitChecks.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 2 });
		const res = await get();
		expect(res.status).toBe(429);
	});

	it('rejects a malformed client id before it reaches the store', async () => {
		const res = await get('not a client id!');
		expect(res.status).toBe(400);
		expect(mocks.createEventStream).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			'not a client id!'
		);
	});
});

describe('GET /api/sync/events as a WebSocket', () => {
	function upgrade(headers: Record<string, string>, clientId = 'device-abc'): Promise<Response> {
		const url = new URL(`https://relay.example/api/sync/events?clientId=${clientId}`);
		return (
			GET as unknown as (event: {
				request: Request;
				url: URL;
				getClientAddress(): string;
			}) => Promise<Response>
		)({
			request: new Request(url, {
				headers: { upgrade: 'websocket', origin: 'https://relay.example', ...headers }
			}),
			url,
			getClientAddress: () => '127.0.0.1'
		});
	}

	it('authenticates the token offered as a subprotocol and hands the socket to the store', async () => {
		mocks.createEventSocket.mockClear();
		const res = await upgrade({ 'sec-websocket-protocol': `scrapscache-sync, ${VALID_TOKEN}` });
		expect(res.status).toBe(200);
		expect(mocks.authenticateToken).toHaveBeenCalledWith(VALID_TOKEN);
		expect(mocks.createEventSocket).toHaveBeenCalledWith('account-123456789', 9_000, 'device-abc');
	});

	it.each([
		['no protocol', {}],
		['another protocol', { 'sec-websocket-protocol': `chat, ${VALID_TOKEN}` }],
		['a token alone', { 'sec-websocket-protocol': VALID_TOKEN }],
		['an unknown token', { 'sec-websocket-protocol': `scrapscache-sync, ${'b'.repeat(43)}` }],
		[
			'a bearer header instead',
			{ 'sec-websocket-protocol': 'scrapscache-sync', authorization: `Bearer ${VALID_TOKEN}` }
		]
	])('refuses %s with 401', async (_name, headers) => {
		mocks.createEventSocket.mockClear();
		const res = await upgrade(headers);
		expect(res.status).toBe(401);
		expect(mocks.createEventSocket).not.toHaveBeenCalled();
	});

	it('refuses a socket opened from another origin', async () => {
		mocks.createEventSocket.mockClear();
		mocks.authenticateToken.mockClear();
		const res = await upgrade({
			origin: 'https://evil.example',
			'sec-websocket-protocol': `scrapscache-sync, ${VALID_TOKEN}`
		});
		expect(res.status).toBe(403);
		expect(mocks.authenticateToken).not.toHaveBeenCalled();
		expect(mocks.createEventSocket).not.toHaveBeenCalled();
	});
});
