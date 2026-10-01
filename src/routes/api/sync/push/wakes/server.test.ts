import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	arm: vi.fn(async () => undefined),
	savePushDevice: vi.fn(async () => undefined),
	replaceReminderWakes: vi.fn(async () => true),
	getReminderWakes: vi.fn(async () => ({
		revision: 1,
		wakes: [{ id: 'a'.repeat(43), fireAt: 12345 }]
	}))
}));

vi.mock('$lib/server/rateLimit', () => ({
	clientAddress: (get: () => string) => get(),
	getPublicApiLimiter: () => ({ check: () => ({ allowed: true }) }),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));
vi.mock('$lib/server/syncAuth', () => ({
	getSyncAuth: () => ({ authenticateSyncRequest: async () => 'account-aaaaaaaaaaaa' })
}));
vi.mock('$lib/server/syncStore', async (original) => ({
	...(await original<typeof import('$lib/server/syncStore')>()),
	getSyncStore: () => ({
		savePushDevice: mocks.savePushDevice,
		replaceReminderWakes: mocks.replaceReminderWakes,
		getReminderWakes: mocks.getReminderWakes
	})
}));
vi.mock('$lib/server/pushWakes', async (original) => ({
	...(await original<typeof import('$lib/server/pushWakes')>()),
	isPublicEndpoint: async () => true
}));
vi.mock('$lib/server/wakeTimer', () => ({ armWakeTimer: mocks.arm }));

import { GET, POST, PUT } from './+server';

type Handler = (event: { request: Request; getClientAddress(): string }) => Promise<Response>;

function call(handler: unknown, method: string, body: unknown): Promise<Response> {
	return (handler as Handler)({
		request: new Request('https://example.test/api/sync/push/wakes', {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		getClientAddress: () => '203.0.113.9'
	});
}

describe('reminder wake registration', () => {
	afterEach(() => vi.clearAllMocks());

	it('schedules delivery when an account stores its wakes', async () => {
		const response = await call(PUT, 'PUT', {
			revision: 1,
			wakes: [{ id: 'a'.repeat(43), fireAt: Date.now() + 60_000 }]
		});
		expect(response.status).toBe(200);
		expect(mocks.arm).toHaveBeenCalledWith('account-aaaaaaaaaaaa', expect.any(Number));
	});

	it('schedules delivery when a browser registers, so a wake already due reaches it', async () => {
		const response = await call(POST, 'POST', {
			deviceId: 'device-aaaaaaaaaaaa',
			subscription: {
				endpoint: 'https://push.example/device',
				keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) }
			}
		});
		expect(response.status).toBe(200);
		expect(mocks.arm).toHaveBeenCalledWith('account-aaaaaaaaaaaa', expect.any(Number));
	});

	it('still stores the wakes when the scheduler cannot be reached', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		mocks.arm.mockRejectedValueOnce(new Error('unreachable'));
		const response = await call(PUT, 'PUT', { revision: 2, wakes: [] });
		expect(response.status).toBe(200);
		expect(mocks.replaceReminderWakes).toHaveBeenCalled();
		error.mockRestore();
	});

	it('fetches wakes for the authenticated account', async () => {
		const response = await (GET as Handler)({
			request: new Request('https://example.test/api/sync/push/wakes', {
				method: 'GET'
			}),
			getClientAddress: () => '203.0.113.9'
		});
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.revision).toBe(1);
		expect(data.wakes).toEqual([{ id: 'a'.repeat(43), fireAt: 12345 }]);
		expect(mocks.getReminderWakes).toHaveBeenCalledWith('account-aaaaaaaaaaaa');
	});
});
