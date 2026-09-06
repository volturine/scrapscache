import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	authenticate: vi.fn((): string | null => 'account-123456789'),
	createEventStream: vi.fn((_accountId: string, _signal?: AbortSignal) => {
		return new Response(': ok\n\n', {
			headers: { 'Content-Type': 'text/event-stream' }
		});
	}),
	limitChecks: vi.fn<(key: string) => { allowed: boolean; retryAfterSeconds?: number }>(() => ({
		allowed: true
	}))
}));

vi.mock('$lib/server/syncStore', () => ({
	getSyncStore: () => ({
		createEventStream: mocks.createEventStream
	})
}));

vi.mock('$lib/server/syncAuth', () => ({
	getSyncAuth: () => ({
		authenticateSyncRequest: mocks.authenticate
	})
}));

vi.mock('$lib/server/rateLimit', () => ({
	clientAddress: () => '127.0.0.1',
	getPublicApiLimiter: () => ({ check: (key: string) => mocks.limitChecks(key) }),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));

import { GET } from './+server';

async function get(): Promise<Response> {
	return (
		GET as unknown as (event: { request: Request; getClientAddress(): string }) => Promise<Response>
	)({
		request: new Request('http://localhost/api/sync/events', {
			headers: { authorization: 'Bearer valid-session' }
		}),
		getClientAddress: () => '127.0.0.1'
	});
}

describe('GET /api/sync/events', () => {
	it('returns event stream response for authenticated requests', async () => {
		mocks.authenticate.mockReturnValueOnce('account-123456789');
		const res = await get();
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/event-stream');
		expect(mocks.createEventStream).toHaveBeenCalledWith('account-123456789', expect.any(Object));
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
});
