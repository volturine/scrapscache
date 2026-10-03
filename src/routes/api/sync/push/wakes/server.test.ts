import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	check: vi.fn(() => ({ allowed: true })),
	authenticate: vi.fn(async (): Promise<string | null> => 'account-aaaaaaaaaaaa'),
	arm: vi.fn(async () => undefined),
	savePushDevice: vi.fn(async () => undefined),
	replaceReminderWakes: vi.fn(async () => true),
	getReminderWakes: vi.fn(async () => ({
		revision: 1,
		wakes: [{ id: 'a'.repeat(43), fireAt: 12345 }]
	}))
}));

vi.mock('#lib/server/rateLimit.js', () => ({
	clientAddress: (get: () => string) => get(),
	getPublicApiLimiter: () => ({ check: mocks.check }),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));
vi.mock('#lib/server/syncAuth.js', () => ({
	getSyncAuth: () => ({ authenticateSyncRequest: mocks.authenticate })
}));
vi.mock('#lib/server/syncStore.js', async (original) => ({
	...(await original<typeof import('#lib/server/syncStore.js')>()),
	getSyncStore: () => ({
		savePushDevice: mocks.savePushDevice,
		replaceReminderWakes: mocks.replaceReminderWakes,
		getReminderWakes: mocks.getReminderWakes
	})
}));
vi.mock('#lib/server/pushWakes.js', async (original) => ({
	...(await original<typeof import('#lib/server/pushWakes.js')>()),
	isPublicEndpoint: async () => true
}));
vi.mock('#lib/server/wakeTimer.js', () => ({ armWakeTimer: mocks.arm }));

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
	afterEach(() => {
		vi.clearAllMocks();
		mocks.check.mockReturnValue({ allowed: true });
		mocks.authenticate.mockResolvedValue('account-aaaaaaaaaaaa');
	});

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

	const get = () =>
		(GET as Handler)({
			request: new Request('https://example.test/api/sync/push/wakes'),
			getClientAddress: () => '203.0.113.9'
		});

	it('refuses to list wakes without a valid sync session', async () => {
		mocks.authenticate.mockResolvedValue(null);
		expect((await get()).status).toBe(401);
		expect(mocks.getReminderWakes).not.toHaveBeenCalled();
	});

	it('rate limits listing wakes by address', async () => {
		mocks.check.mockReturnValue({ allowed: false });
		expect((await get()).status).toBe(429);
		expect(mocks.authenticate).not.toHaveBeenCalled();
		expect(mocks.getReminderWakes).not.toHaveBeenCalled();
	});

	it('reports the schedule as unavailable when the store fails', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		mocks.getReminderWakes.mockRejectedValueOnce(new Error('db down'));
		expect((await get()).status).toBe(503);
		error.mockRestore();
	});
});
