import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
	account: 'account' as string | null,
	allowed: true,
	open: vi.fn(
		async () =>
			new Response(': connected\n\n', { headers: { 'content-type': 'text/event-stream' } })
	)
}));
vi.mock('$lib/server/syncAuth', () => ({
	getSyncAuth: () => ({ authenticateSyncRequest: async () => mocks.account })
}));
vi.mock('$lib/server/rateLimit', () => ({
	clientAddress: () => 'test',
	getPublicApiLimiter: () => ({ check: async () => ({ allowed: mocks.allowed }) }),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));
vi.mock('$lib/server/reminderEvents', () => ({ openReminderEvents: mocks.open }));
import { GET } from './+server';
beforeEach(() => {
	mocks.account = 'account';
	mocks.allowed = true;
	mocks.open.mockClear();
});
const get = (query = '') => {
	const url = new URL(`https://example.test/api/sync/reminders/events${query}`);
	return GET({
		request: new Request(url),
		url,
		getClientAddress: () => 'test'
	} as never) as Promise<Response>;
};
describe('reminder SSE endpoint', () => {
	it('requires authentication and limits connection attempts', async () => {
		mocks.account = null;
		expect((await get()).status).toBe(401);
		mocks.allowed = false;
		expect((await get()).status).toBe(429);
		expect(mocks.open).not.toHaveBeenCalled();
	});
	it('opens only the authenticated account stream, for the window that asked', async () => {
		const response = await get('?clientId=window-1');
		expect(response.headers.get('content-type')).toBe('text/event-stream');
		expect(mocks.open).toHaveBeenCalledWith('account', expect.any(AbortSignal), 'window-1');
	});
	it('rejects a malformed client id', async () => {
		expect((await get('?clientId=%3Cscript%3E')).status).toBe(400);
		expect(mocks.open).not.toHaveBeenCalled();
	});
});
