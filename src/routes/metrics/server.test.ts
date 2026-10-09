import { afterEach, describe, expect, it, vi } from 'vitest';
import { privateEnv } from '../../tests/env';

const mocks = vi.hoisted(() => ({
	limit: vi.fn<() => { allowed: boolean }>(() => ({ allowed: true })),
	operatorUsage: vi.fn(async () => ({
		accounts: 0,
		envelopeCount: 0,
		ciphertextBytes: 0,
		storageBytes: 0,
		activeByWindowDays: {},
		staleAccounts: 0
	}))
}));

vi.mock('#lib/server/rateLimit.js', () => ({
	checkAdminApiLimit: () => mocks.limit(),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));
vi.mock('#lib/server/syncStore.js', () => ({
	getSyncStore: () => ({ operatorUsage: mocks.operatorUsage })
}));
vi.mock('#lib/server/runtimeSettings.js', () => ({
	getRuntimeSettings: async () => ({ retentionInactiveDays: 0 })
}));
vi.mock('#lib/server/retentionSweep.js', () => ({
	getRetentionStatus: async () => ({ enabled: false })
}));
vi.mock('#lib/server/metrics.js', () => ({
	metricsSnapshot: () => ({}),
	renderMetrics: () => 'scrapscache_up 1\n'
}));

import { GET } from './+server';

function get(token?: string): Promise<Response> {
	return (
		GET as unknown as (event: { request: Request; getClientAddress(): string }) => Promise<Response>
	)({
		request: new Request('https://example.test/metrics', {
			...(token ? { headers: { authorization: `Bearer ${token}` } } : {})
		}),
		getClientAddress: () => '203.0.113.4'
	});
}

describe('metrics endpoint', () => {
	afterEach(() => {
		delete privateEnv.SCRAPSCACHE_ADMIN_TOKEN;
		vi.clearAllMocks();
	});

	it('serves metrics to the configured admin token', async () => {
		privateEnv.SCRAPSCACHE_ADMIN_TOKEN = 'admin-token';
		const response = await get('admin-token');

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('scrapscache_up 1\n');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('hides itself from a wrong token or a disabled admin API', async () => {
		privateEnv.SCRAPSCACHE_ADMIN_TOKEN = 'admin-token';
		expect((await get('wrong-token')).status).toBe(404);
		delete privateEnv.SCRAPSCACHE_ADMIN_TOKEN;
		expect((await get('admin-token')).status).toBe(404);
		expect(mocks.operatorUsage).not.toHaveBeenCalled();
	});

	it('charges the admin throttle on every request, before the token check', async () => {
		privateEnv.SCRAPSCACHE_ADMIN_TOKEN = 'admin-token';
		await get('wrong-token');
		expect(mocks.limit).toHaveBeenCalledOnce();

		mocks.limit.mockReturnValueOnce({ allowed: false });
		const response = await get('admin-token');

		expect(response.status).toBe(429);
		expect(mocks.operatorUsage).not.toHaveBeenCalled();
	});
});
