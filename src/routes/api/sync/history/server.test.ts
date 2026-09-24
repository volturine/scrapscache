import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	authenticate: vi.fn((): string | null => 'owner'),
	listHistory: vi.fn(),
	getEnvelopeAt: vi.fn()
}));

vi.mock('$lib/server/syncStore', () => ({
	getSyncStore: () => ({
		listHistory: mocks.listHistory,
		getEnvelopeAt: mocks.getEnvelopeAt
	})
}));
vi.mock('$lib/server/syncAuth', () => ({
	getSyncAuth: () => ({ authenticateSyncRequest: mocks.authenticate })
}));
vi.mock('$lib/server/rateLimit', () => ({
	clientAddress: () => '127.0.0.1',
	getPublicApiLimiter: () => ({ check: async () => ({ allowed: true }) }),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));

import { GET } from './+server';

async function get(query = ''): Promise<Response> {
	const url = new URL(`http://localhost/api/sync/history${query}`);
	return (
		GET as unknown as (event: {
			request: Request;
			url: URL;
			getClientAddress(): string;
		}) => Promise<Response>
	)({
		request: new Request(url, { headers: { authorization: 'Bearer token' } }),
		url,
		getClientAddress: () => '127.0.0.1'
	});
}

describe('sync history route', () => {
	const slot = 'a'.repeat(64);

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.authenticate.mockReturnValue('owner');
		mocks.listHistory.mockResolvedValue({
			versions: [{ historyId: 1, savedAt: 1, id: 'opaque', ciphertext: 'secret' }]
		});
		mocks.getEnvelopeAt.mockResolvedValue({ id: 'opaque', slot, ciphertext: 'secret' });
	});

	it('requires an authenticated sync session before reading history', async () => {
		mocks.authenticate.mockReturnValue(null);
		expect((await get(`?slot=${slot}`)).status).toBe(401);
		expect(mocks.listHistory).not.toHaveBeenCalled();
	});

	it('lists a record’s encrypted versions in one private response', async () => {
		const response = await get(`?slot=${slot}`);
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			versions: [{ historyId: 1, savedAt: 1, id: 'opaque', ciphertext: 'secret' }]
		});
		expect(mocks.listHistory).toHaveBeenCalledWith('owner', slot);
	});

	it('looks up the version saved at a time for the authenticated account', async () => {
		expect((await get(`?slot=${slot}&at=12`)).status).toBe(200);
		expect(mocks.getEnvelopeAt).toHaveBeenCalledWith('owner', slot, 12);
		mocks.getEnvelopeAt.mockResolvedValue(null);
		expect((await get(`?slot=${slot}&at=12`)).status).toBe(404);
	});

	it('rejects missing or malformed slots and times before querying storage', async () => {
		expect((await get()).status).toBe(400);
		expect((await get('?slot=plain')).status).toBe(400);
		expect((await get(`?slot=${slot}&at=-1`)).status).toBe(400);
		expect((await get(`?slot=${slot}&at=1.5`)).status).toBe(400);
		expect(mocks.listHistory).not.toHaveBeenCalled();
		expect(mocks.getEnvelopeAt).not.toHaveBeenCalled();
	});
});
