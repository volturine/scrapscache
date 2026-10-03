import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
	account: 'account' as string | null,
	exchange: vi.fn(async () => ({ cursor: 1, hasMore: false, notes: [] }))
}));
vi.mock('#lib/server/syncAuth.js', () => ({
	getSyncAuth: () => ({ authenticateSyncRequest: async () => mocks.account })
}));
vi.mock('#lib/server/rateLimit.js', () => ({
	clientAddress: () => 'test',
	getPublicApiLimiter: () => ({ check: async () => ({ allowed: true }) }),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));
vi.mock('#lib/server/reminderHistoryRelay.js', async (original) => ({
	...(await original<typeof import('#lib/server/reminderHistoryRelay.js')>()),
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
		expect((await call({ cursor: 0, notes: [] })).status).toBe(401);
		expect(mocks.exchange).not.toHaveBeenCalled();
	});
	it('rejects invalid cursors, plaintext, repeated notes and oversized batches', async () => {
		const row = { note: 'a'.repeat(64), deleted: false, ciphertext: 'c'.repeat(100) };
		for (const body of [
			null,
			{},
			{ cursor: -1, notes: [] },
			{ cursor: 0, notes: [{ noteId: 'plaintext' }] },
			{ cursor: 0, notes: [row, row] },
			{ cursor: 0, notes: Array(51).fill(row) }
		])
			expect((await call(body)).status).toBe(400);
		expect(mocks.exchange).not.toHaveBeenCalled();
	});
	it('returns the separate receipt cursor without cacheability', async () => {
		const response = await call({ cursor: 0, notes: [] });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ cursor: 1, hasMore: false, notes: [] });
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mocks.exchange).toHaveBeenCalledWith('account', 0, []);
	});
});
