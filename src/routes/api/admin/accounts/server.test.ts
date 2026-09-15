import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	requireAdmin: vi.fn(async (): Promise<Response | null> => null),
	listAccounts: vi.fn(async () => ({ total: 1, accounts: [{ accountId: 'account-abcdefghij' }] })),
	getAuthCredential: vi.fn(async (): Promise<string | null> => 'public-key'),
	setAccountByteQuota: vi.fn(async () => true),
	clearAccountByteQuota: vi.fn(async () => true),
	setAccountRateLimit: vi.fn(async () => true),
	clearAccountRateLimit: vi.fn(async () => true)
}));

vi.mock('$lib/server/adminAuth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('$lib/server/syncStore', () => ({ getSyncStore: () => mocks }));
vi.mock('$lib/server/runtimeSettings', () => ({
	getRuntimeSettings: async () => ({ maxAccountBytes: 5_000, syncPerMinute: 12 })
}));

import { GET, PATCH } from './+server';

const ACCOUNT = 'account-abcdefghij';

function get(query = ''): Promise<Response> {
	const url = new URL(`https://example.test/api/admin/accounts${query}`);
	return (
		GET as unknown as (event: {
			request: Request;
			url: URL;
			getClientAddress(): string;
		}) => Promise<Response>
	)({ request: new Request(url), url, getClientAddress: () => '203.0.113.1' });
}

function patch(body: unknown): Promise<Response> {
	return (
		PATCH as unknown as (event: {
			request: Request;
			getClientAddress(): string;
		}) => Promise<Response>
	)({
		request: new Request('https://example.test/api/admin/accounts', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		getClientAddress: () => '203.0.113.1'
	});
}

afterEach(() => {
	vi.clearAllMocks();
	mocks.requireAdmin.mockResolvedValue(null);
	mocks.getAuthCredential.mockResolvedValue('public-key');
});

describe('listing accounts', () => {
	it('returns a page', async () => {
		const response = await get('?limit=10');
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ total: 1 });
		expect(mocks.listAccounts).toHaveBeenCalledWith({
			limit: 10,
			offset: undefined,
			search: undefined,
			defaultMaxAccountBytes: 5_000,
			defaultSyncPerMinute: 12
		});
	});

	it('returns one account', async () => {
		const response = await get(`?accountId=${ACCOUNT}`);
		expect(await response.json()).toEqual({ accountId: ACCOUNT });
		expect(mocks.listAccounts).toHaveBeenCalledWith({
			accountId: ACCOUNT,
			defaultMaxAccountBytes: 5_000,
			defaultSyncPerMinute: 12
		});
	});

	it('refuses an account id that is not shaped like one', async () => {
		expect((await get('?accountId=nope')).status).toBe(400);
		expect(mocks.listAccounts).not.toHaveBeenCalled();
	});

	it('hides everything behind the admin guard', async () => {
		mocks.requireAdmin.mockResolvedValue(new Response(null, { status: 404 }));
		expect((await get()).status).toBe(404);
		expect(mocks.listAccounts).not.toHaveBeenCalled();
	});
});

describe('changing what one account is allowed', () => {
	it('sets both limits in one request', async () => {
		await patch({
			accountId: ACCOUNT,
			maxBytes: 5_000,
			syncPerMinute: 240
		});

		expect(mocks.setAccountByteQuota).toHaveBeenCalledWith(ACCOUNT, 5_000);
		expect(mocks.setAccountRateLimit).toHaveBeenCalledWith(ACCOUNT, 240);
	});

	it('reads null as "back to the shared default", not as zero', async () => {
		await patch({ accountId: ACCOUNT, maxBytes: null, syncPerMinute: null });

		expect(mocks.clearAccountByteQuota).toHaveBeenCalledWith(ACCOUNT);
		expect(mocks.clearAccountRateLimit).toHaveBeenCalledWith(ACCOUNT);
		expect(mocks.setAccountByteQuota).not.toHaveBeenCalled();
	});

	it('leaves out what was not mentioned', async () => {
		await patch({ accountId: ACCOUNT, syncPerMinute: 10 });

		expect(mocks.setAccountRateLimit).toHaveBeenCalled();
		expect(mocks.setAccountByteQuota).not.toHaveBeenCalled();
		expect(mocks.clearAccountByteQuota).not.toHaveBeenCalled();
	});

	it('rejects a limit that would stop the account working, before touching anything', async () => {
		for (const body of [
			{ accountId: ACCOUNT, maxBytes: 0 },
			{ accountId: ACCOUNT, syncPerMinute: -5 },
			{ accountId: ACCOUNT, maxBytes: 1.5 }
		]) {
			expect((await patch(body)).status).toBe(400);
		}
		expect(mocks.setAccountByteQuota).not.toHaveBeenCalled();
		expect(mocks.setAccountRateLimit).not.toHaveBeenCalled();
	});

	it('fails as a whole for an unknown account rather than half-applying', async () => {
		mocks.getAuthCredential.mockResolvedValue(null);

		const response = await patch({ accountId: ACCOUNT, maxBytes: 1_000, syncPerMinute: 10 });

		expect(response.status).toBe(404);
		expect(mocks.setAccountByteQuota).not.toHaveBeenCalled();
		expect(mocks.setAccountRateLimit).not.toHaveBeenCalled();
	});

	it('answers with the account as it now stands', async () => {
		const response = await patch({ accountId: ACCOUNT, syncPerMinute: 10 });
		expect(await response.json()).toEqual({ accountId: ACCOUNT });
	});
});
