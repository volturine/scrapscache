import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	authenticate: vi.fn((): string | null => 'owner'),
	listHistory: vi.fn(),
	getHistory: vi.fn(),
	getEnvelopeAt: vi.fn()
}));

vi.mock('$lib/server/syncStore', () => ({
	getSyncStore: () => ({
		listHistory: mocks.listHistory,
		getHistory: mocks.getHistory,
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
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.authenticate.mockReturnValue('owner');
		mocks.listHistory.mockResolvedValue({ entries: [], nextBefore: null });
		mocks.getHistory.mockResolvedValue({
			id: 'opaque',
			slot: 'a'.repeat(64),
			ciphertext: 'secret'
		});
		mocks.getEnvelopeAt.mockResolvedValue(null);
	});

	it('requires an authenticated sync session before reading history', async () => {
		mocks.authenticate.mockReturnValue(null);
		expect((await get()).status).toBe(401);
		expect(mocks.listHistory).not.toHaveBeenCalled();
	});

	it('scopes list and detail reads to the authenticated account', async () => {
		const page = await get(`?noteSlot=${'a'.repeat(64)}&before=12`);
		expect(page.status).toBe(200);
		expect(page.headers.get('cache-control')).toBe('no-store');
		expect(mocks.listHistory).toHaveBeenCalledWith('owner', 'a'.repeat(64), 12);
		expect((await get('?id=9')).status).toBe(200);
		expect(mocks.getHistory).toHaveBeenCalledWith('owner', 9);
	});

	it('rejects malformed ids and slots before querying storage', async () => {
		expect((await get('?id=-1')).status).toBe(400);
		expect((await get('?slot=plain&at=1')).status).toBe(400);
		expect((await get('?before=12')).status).toBe(400);
		expect(mocks.getHistory).not.toHaveBeenCalled();
		expect(mocks.getEnvelopeAt).not.toHaveBeenCalled();
		expect((await get('?noteSlot=plain')).status).toBe(400);
	});

	it('filters note version lists by the authenticated opaque slot', async () => {
		await get(`?noteSlot=${'a'.repeat(64)}`);
		expect(mocks.listHistory).toHaveBeenCalledWith('owner', 'a'.repeat(64), undefined);
	});
});
