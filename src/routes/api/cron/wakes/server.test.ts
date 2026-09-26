import { afterEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({}) as Record<string, string | undefined>);
const mocks = vi.hoisted(() => ({
	dispatch: vi.fn(async () => ({ sent: 1, failed: 0, gone: 0, next: 120_000 })),
	reschedule: vi.fn(async () => undefined),
	limit: vi.fn(() => ({ allowed: true }))
}));

vi.mock('$env/dynamic/private', () => ({ env: envMock }));
vi.mock('$lib/server/rateLimit', () => ({
	clientAddress: (get: () => string) => get(),
	getPublicApiLimiter: () => ({ check: mocks.limit }),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));
vi.mock('$lib/server/db', () => ({ getDb: () => ({ ready: Promise.resolve() }) }));
vi.mock('$lib/server/wakeDispatch', () => ({ dispatchDueWakes: mocks.dispatch }));
vi.mock('$lib/server/wakeTimer', () => ({ rescheduleWakeTimer: mocks.reschedule }));

import { POST } from './+server';

const ACCOUNT = 'account-aaaaaaaaaaaa';

function post(token?: string, body: unknown = { accountId: ACCOUNT }): Promise<Response> {
	return (
		POST as unknown as (event: {
			request: Request;
			getClientAddress(): string;
		}) => Promise<Response>
	)({
		request: new Request('https://example.test/api/cron/wakes', {
			method: 'POST',
			body: JSON.stringify(body),
			...(token ? { headers: { authorization: `Bearer ${token}` } } : {})
		}),
		getClientAddress: () => '203.0.113.9'
	});
}

describe('wake delivery endpoint', () => {
	afterEach(() => {
		delete envMock.SCRAPSCACHE_TICK_SECRET;
		vi.clearAllMocks();
	});

	it("delivers the account's due wakes and sets its next delivery", async () => {
		envMock.SCRAPSCACHE_TICK_SECRET = 'tick-secret';
		const response = await post('tick-secret');
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ sent: 1, next: 120_000 });
		expect(mocks.dispatch).toHaveBeenCalledWith({ accountId: ACCOUNT });
		expect(mocks.reschedule).toHaveBeenCalledWith(ACCOUNT, 120_000);
		// Every account's alarm lands here at once; the secret holder is never throttled.
		expect(mocks.limit).not.toHaveBeenCalled();
	});

	it('requires an account', async () => {
		envMock.SCRAPSCACHE_TICK_SECRET = 'tick-secret';
		expect((await post('tick-secret', {})).status).toBe(400);
		expect(mocks.dispatch).not.toHaveBeenCalled();
	});

	it('refuses callers without the tick secret, and throttles them', async () => {
		envMock.SCRAPSCACHE_TICK_SECRET = 'tick-secret';
		expect((await post('wrong')).status).toBe(404);
		expect((await post()).status).toBe(404);
		mocks.limit.mockReturnValueOnce({ allowed: false });
		expect((await post('wrong')).status).toBe(429);
		expect(mocks.dispatch).not.toHaveBeenCalled();
	});
});
