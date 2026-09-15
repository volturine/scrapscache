import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	authenticate: vi.fn(async (): Promise<string | null> => 'account-abcdefghij'),
	accountFeatureFlags: vi.fn(async () => ({ 'canvas-beta': true })),
	limit: vi.fn(() => ({ allowed: true }))
}));

vi.mock('$lib/server/syncAuth', () => ({
	getSyncAuth: () => ({ authenticateSyncRequest: mocks.authenticate })
}));
vi.mock('$lib/server/syncStore', () => ({
	getSyncStore: () => ({ accountFeatureFlags: mocks.accountFeatureFlags })
}));
vi.mock('$lib/server/rateLimit', () => ({
	clientAddress: (get: () => string) => get(),
	getPublicApiLimiter: () => ({ check: () => mocks.limit() }),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));

import { GET } from './+server';

function get(): Promise<Response> {
	return (
		GET as unknown as (event: { request: Request; getClientAddress(): string }) => Promise<Response>
	)({
		request: new Request('https://example.test/api/sync/features', {
			headers: { authorization: 'Bearer token' }
		}),
		getClientAddress: () => '203.0.113.7'
	});
}

afterEach(() => {
	vi.clearAllMocks();
	mocks.authenticate.mockResolvedValue('account-abcdefghij');
	mocks.limit.mockReturnValue({ allowed: true });
});

describe('which gated features an account may use', () => {
	it('returns the resolved set for the authenticated account', async () => {
		const response = await get();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ flags: { 'canvas-beta': true } });
		expect(mocks.accountFeatureFlags).toHaveBeenCalledWith('account-abcdefghij');
	});

	it('tells nobody anything without a session', async () => {
		mocks.authenticate.mockResolvedValue(null);
		expect((await get()).status).toBe(401);
		expect(mocks.accountFeatureFlags).not.toHaveBeenCalled();
	});

	it('throttles before it authenticates', async () => {
		mocks.limit.mockReturnValue({ allowed: false });
		expect((await get()).status).toBe(429);
		expect(mocks.authenticate).not.toHaveBeenCalled();
	});

	it('keeps every gate shut when they cannot be read, rather than failing open', async () => {
		mocks.accountFeatureFlags.mockRejectedValue(new Error('D1 unavailable') as never);

		const response = await get();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ flags: {} });
	});
});
