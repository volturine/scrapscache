import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	authenticate: vi.fn((): string | null => 'owner'),
	listHistory: vi.fn(),
	getHistory: vi.fn(),
	getEnvelopeAt: vi.fn(),
	listProfileHistory: vi.fn(),
	getProfileSnapshot: vi.fn()
}));

vi.mock('$lib/server/syncStore', () => ({
	getSyncStore: () => ({
		listHistory: mocks.listHistory,
		getHistory: mocks.getHistory,
		getEnvelopeAt: mocks.getEnvelopeAt,
		listProfileHistory: mocks.listProfileHistory,
		getProfileSnapshot: mocks.getProfileSnapshot
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
		mocks.listProfileHistory.mockResolvedValue({ points: [], nextBefore: null });
		mocks.getProfileSnapshot.mockResolvedValue({ envelopes: [], nextAfter: null });
	});

	it('requires an authenticated sync session before reading history', async () => {
		mocks.authenticate.mockReturnValue(null);
		expect((await get()).status).toBe(401);
		expect(mocks.listHistory).not.toHaveBeenCalled();
	});

	it('scopes list and detail reads to the authenticated account', async () => {
		const page = await get('?before=12');
		expect(page.status).toBe(200);
		expect(page.headers.get('cache-control')).toBe('no-store');
		expect(mocks.listHistory).toHaveBeenCalledWith('owner', 12, undefined);
		expect((await get('?id=9')).status).toBe(200);
		expect(mocks.getHistory).toHaveBeenCalledWith('owner', 9);
	});

	it('rejects malformed ids and slots before querying storage', async () => {
		expect((await get('?id=-1')).status).toBe(400);
		expect((await get('?slot=plain&at=1')).status).toBe(400);
		expect(mocks.getHistory).not.toHaveBeenCalled();
		expect(mocks.getEnvelopeAt).not.toHaveBeenCalled();
		expect((await get('?noteSlot=plain')).status).toBe(400);
	});

	it('filters note version lists by the authenticated opaque slot', async () => {
		await get(`?noteSlot=${'a'.repeat(64)}`);
		expect(mocks.listHistory).toHaveBeenCalledWith('owner', undefined, 'a'.repeat(64));
	});

	it('serves authenticated profile points and snapshot pages without caching', async () => {
		const points = await get('?points=1&before=123');
		expect(points.status).toBe(200);
		expect(mocks.listProfileHistory).toHaveBeenCalledWith('owner', 123);
		const snapshot = await get(`?profile=123&after=${'a'.repeat(64)}`);
		expect(snapshot.headers.get('cache-control')).toBe('no-store');
		expect(mocks.getProfileSnapshot).toHaveBeenCalledWith('owner', 123, 'a'.repeat(64));
		expect((await get('?profile=0')).status).toBe(400);
	});
});
