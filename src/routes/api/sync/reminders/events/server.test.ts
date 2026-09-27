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
const get = () =>
	GET({
		request: new Request('https://example.test/api/sync/reminders/events'),
		getClientAddress: () => 'test'
	} as never) as Promise<Response>;
describe('reminder SSE endpoint', () => {
	it('requires authentication and limits connection attempts', async () => {
		mocks.account = null;
		expect((await get()).status).toBe(401);
		mocks.allowed = false;
		expect((await get()).status).toBe(429);
		expect(mocks.open).not.toHaveBeenCalled();
	});
	it('opens only the authenticated account stream', async () => {
		const response = await get();
		expect(response.headers.get('content-type')).toBe('text/event-stream');
		expect(mocks.open).toHaveBeenCalledWith('account', expect.any(AbortSignal));
	});
});
