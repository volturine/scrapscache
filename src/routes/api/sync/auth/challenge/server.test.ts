import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	credential: vi.fn(async (): Promise<string | null> => 'public-key'),
	retired: vi.fn(async () => false)
}));

vi.mock('$lib/server/syncStore', () => ({
	getSyncStore: () => ({ getAuthCredential: mocks.credential, isAccountRetired: mocks.retired })
}));
vi.mock('$lib/server/syncAuth', () => ({
	getSyncAuth: () => ({ createSyncChallenge: async () => ({ challengeId: 'id', challenge: 'c' }) }),
	isLegacySyncCredential: () => false
}));
vi.mock('$lib/server/rateLimit', () => ({
	clientAddress: () => '127.0.0.1',
	getPublicApiLimiter: () => ({ check: async () => ({ allowed: true }) }),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));

import { POST } from './+server';

async function post(): Promise<Response> {
	return (
		POST as unknown as (event: {
			request: Request;
			getClientAddress(): string;
		}) => Promise<Response>
	)({
		request: new Request('https://example.test/api/sync/auth/challenge', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ accountId: 'account-123456789' })
		}),
		getClientAddress: () => '127.0.0.1'
	});
}

describe('POST /api/sync/auth/challenge', () => {
	beforeEach(() => {
		mocks.credential.mockReset().mockResolvedValue('public-key');
		mocks.retired.mockReset().mockResolvedValue(false);
	});

	it('issues a challenge for an existing account', async () => {
		expect((await post()).status).toBe(200);
		expect(mocks.retired).not.toHaveBeenCalled();
	});

	it('reports a missing account as not found', async () => {
		mocks.credential.mockResolvedValue(null);
		expect((await post()).status).toBe(404);
	});

	it('reports a retired key so the device replaces it instead of recovering it', async () => {
		mocks.credential.mockResolvedValue(null);
		mocks.retired.mockResolvedValue(true);

		const response = await post();

		expect(response.status).toBe(410);
		expect(await response.json()).toMatchObject({ retired: true });
	});
});
