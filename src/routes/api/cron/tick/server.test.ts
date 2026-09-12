import { afterEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({}) as Record<string, string | undefined>);
const mocks = vi.hoisted(() => ({
	limit: vi.fn<(key: string) => { allowed: boolean }>(() => ({ allowed: true })),
	runCronTick: vi.fn(async () => ({ wakes: { sent: 1, failed: 0, gone: 0 } }))
}));

vi.mock('$env/dynamic/private', () => ({ env: envMock }));
vi.mock('$lib/server/rateLimit', () => ({
	clientAddress: (get: () => string) => get(),
	getPublicApiLimiter: () => ({ check: (key: string) => mocks.limit(key) }),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));
vi.mock('$lib/server/cronTick', () => ({ runCronTick: mocks.runCronTick }));

import { POST } from './+server';

function post(token?: string, address = '203.0.113.9'): Promise<Response> {
	return (
		POST as unknown as (event: {
			request: Request;
			getClientAddress(): string;
		}) => Promise<Response>
	)({
		request: new Request('https://example.test/api/cron/tick', {
			method: 'POST',
			...(token ? { headers: { authorization: `Bearer ${token}` } } : {})
		}),
		getClientAddress: () => address
	});
}

describe('cron tick endpoint', () => {
	afterEach(() => {
		delete envMock.SCRAPSCACHE_TICK_SECRET;
		vi.clearAllMocks();
	});

	it('runs the tick for the configured secret', async () => {
		envMock.SCRAPSCACHE_TICK_SECRET = 'tick-secret';
		const response = await post('tick-secret');
		expect(response.status).toBe(200);
		expect(mocks.runCronTick).toHaveBeenCalledOnce();
	});

	it('hides the endpoint when no secret is configured', async () => {
		expect((await post('anything')).status).toBe(404);
		expect(mocks.runCronTick).not.toHaveBeenCalled();
	});

	it('answers a wrong secret with the same 404 as a missing one', async () => {
		envMock.SCRAPSCACHE_TICK_SECRET = 'tick-secret';
		expect((await post('wrong-secret')).status).toBe(404);
		expect((await post()).status).toBe(404);
		expect(mocks.runCronTick).not.toHaveBeenCalled();
	});

	it('throttles guessing before it compares the secret', async () => {
		envMock.SCRAPSCACHE_TICK_SECRET = 'tick-secret';
		mocks.limit.mockResolvedValueOnce({ allowed: false } as never);
		const response = await post('tick-secret');
		expect(response.status).toBe(429);
		expect(mocks.runCronTick).not.toHaveBeenCalled();
	});

	it('buckets each caller by address so one prober cannot starve the scheduler', async () => {
		envMock.SCRAPSCACHE_TICK_SECRET = 'tick-secret';
		await post('tick-secret', '203.0.113.9');
		await post('tick-secret', 'unknown');
		expect(mocks.limit).toHaveBeenNthCalledWith(1, 'cron:203.0.113.9');
		expect(mocks.limit).toHaveBeenNthCalledWith(2, 'cron:unknown');
	});
});
