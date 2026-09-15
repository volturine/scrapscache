import { afterEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({}) as Record<string, string | undefined>);
const mocks = vi.hoisted(() => ({
	limit: vi.fn<() => { allowed: boolean }>(() => ({ allowed: true })),
	queryTelemetry: vi.fn(async (hours: number) => ({
		available: true,
		source: 'dataset',
		windowHours: hours,
		activity: null,
		http: []
	}))
}));

vi.mock('$env/dynamic/private', () => ({ env: envMock }));
vi.mock('$lib/server/rateLimit', () => ({
	checkAdminApiLimit: () => mocks.limit(),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));
vi.mock('$lib/server/telemetryQuery', () => ({ queryTelemetry: mocks.queryTelemetry }));

import { GET } from './+server';

function get(token?: string, query = ''): Promise<Response> {
	return (
		GET as unknown as (event: {
			request: Request;
			url: URL;
			getClientAddress(): string;
		}) => Promise<Response>
	)({
		request: new Request(`https://example.test/api/admin/telemetry${query}`, {
			...(token ? { headers: { authorization: `Bearer ${token}` } } : {})
		}),
		url: new URL(`https://example.test/api/admin/telemetry${query}`),
		getClientAddress: () => '203.0.113.4'
	});
}

describe('admin telemetry endpoint', () => {
	afterEach(() => {
		delete envMock.SCRAPSCACHE_ADMIN_TOKEN;
		vi.clearAllMocks();
	});

	it('returns the report for the configured admin token', async () => {
		envMock.SCRAPSCACHE_ADMIN_TOKEN = 'admin-token';
		const response = await get('admin-token', '?hours=6');

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ windowHours: 6 });
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('defaults to a day when the window is missing or nonsense', async () => {
		envMock.SCRAPSCACHE_ADMIN_TOKEN = 'admin-token';
		await get('admin-token');
		await get('admin-token', '?hours=-3');
		await get('admin-token', '?hours=banana');

		expect(mocks.queryTelemetry.mock.calls.map(([hours]) => hours)).toEqual([24, 24, 24]);
	});

	it('hides itself from anyone without the token, and when none is set', async () => {
		envMock.SCRAPSCACHE_ADMIN_TOKEN = 'admin-token';
		expect((await get('wrong-token')).status).toBe(404);
		expect((await get()).status).toBe(404);

		delete envMock.SCRAPSCACHE_ADMIN_TOKEN;
		expect((await get('admin-token')).status).toBe(404);
		expect(mocks.queryTelemetry).not.toHaveBeenCalled();
	});

	it('throttles before it authenticates', async () => {
		envMock.SCRAPSCACHE_ADMIN_TOKEN = 'admin-token';
		mocks.limit.mockReturnValueOnce({ allowed: false });

		expect((await get('admin-token')).status).toBe(429);
		expect(mocks.queryTelemetry).not.toHaveBeenCalled();
	});
});
