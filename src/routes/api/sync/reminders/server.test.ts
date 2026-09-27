import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
	account: 'account' as string | null,
	exchange: vi.fn(async () => ({ cursor: 1, hasMore: false, events: [] }))
}));
vi.mock('$lib/server/syncAuth', () => ({
	getSyncAuth: () => ({ authenticateSyncRequest: async () => mocks.account })
}));
vi.mock('$lib/server/rateLimit', () => ({
	clientAddress: () => 'test',
	getPublicApiLimiter: () => ({ check: async () => ({ allowed: true }) }),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));
vi.mock('$lib/server/reminderHistoryRelay', async (original) => ({
	...(await original<typeof import('$lib/server/reminderHistoryRelay')>()),
	exchangeReminderHistory: mocks.exchange
}));
import { POST } from './+server';
beforeEach(() => {
	mocks.account = 'account';
	mocks.exchange.mockClear();
});
const call = (body: unknown) =>
	POST({
		request: new Request('https://example.test/api/sync/reminders', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
		getClientAddress: () => 'test'
	} as never) as Promise<Response>;
describe('reminder receipt endpoint', () => {
	it('requires authentication', async () => {
		mocks.account = null;
		expect((await call({ cursor: 0, events: [] })).status).toBe(401);
		expect(mocks.exchange).not.toHaveBeenCalled();
	});
	it('rejects invalid cursors, plaintext and oversized batches', async () => {
		for (const body of [
			null,
			{},
			{ cursor: -1, events: [] },
			{ cursor: 0, events: [{ noteId: 'plaintext' }] },
			{ cursor: 0, events: Array(51).fill({}) }
		])
			expect((await call(body)).status).toBe(400);
		expect(mocks.exchange).not.toHaveBeenCalled();
	});
	it('returns the separate receipt cursor without cacheability', async () => {
		const response = await call({ cursor: 0, events: [] });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ cursor: 1, hasMore: false, events: [] });
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mocks.exchange).toHaveBeenCalledWith('account', 0, []);
	});
});
