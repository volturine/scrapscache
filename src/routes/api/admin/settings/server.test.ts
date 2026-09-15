import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	requireAdmin: vi.fn(async (): Promise<Response | null> => null),
	getState: vi.fn(async () => ({ values: {}, defaults: {}, overrides: {} })),
	update: vi.fn(async (patch: unknown) => ({ values: patch, defaults: {}, overrides: patch }))
}));

vi.mock('$lib/server/adminAuth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('$lib/server/runtimeSettings', async (original) => {
	const actual = await original<typeof import('$lib/server/runtimeSettings')>();
	return {
		...actual,
		getRuntimeSettingsState: mocks.getState,
		updateRuntimeSettings: mocks.update
	};
});

import { GET, PATCH } from './+server';

function request(method: 'GET' | 'PATCH', body?: unknown): Promise<Response> {
	const handler = method === 'GET' ? GET : PATCH;
	return (
		handler as unknown as (event: {
			request: Request;
			getClientAddress(): string;
		}) => Promise<Response>
	)({
		request: new Request('https://example.test/api/admin/settings', {
			method,
			...(body === undefined
				? {}
				: { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
		}),
		getClientAddress: () => '203.0.113.1'
	});
}

afterEach(() => {
	vi.clearAllMocks();
	mocks.requireAdmin.mockResolvedValue(null);
});

describe('runtime settings admin endpoint', () => {
	it('hides reads and writes behind the admin guard', async () => {
		mocks.requireAdmin.mockResolvedValue(new Response(null, { status: 404 }));

		expect((await request('GET')).status).toBe(404);
		expect((await request('PATCH', { allowIndexing: true })).status).toBe(404);
		expect(mocks.getState).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it('returns the effective settings without caching them', async () => {
		const response = await request('GET');

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mocks.getState).toHaveBeenCalledOnce();
	});

	it('validates and applies a partial update', async () => {
		const response = await request('PATCH', {
			maxAccountBytes: 5_000,
			allowIndexing: false,
			vapidSubject: ' mailto:ops@example.com '
		});

		expect(response.status).toBe(200);
		expect(mocks.update).toHaveBeenCalledWith({
			maxAccountBytes: 5_000,
			allowIndexing: false,
			vapidSubject: 'mailto:ops@example.com'
		});
	});

	it('rejects an invalid field before writing anything', async () => {
		const response = await request('PATCH', { retentionInactiveDays: -1 });

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Invalid value for retentionInactiveDays' });
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it('uses null to restore the deployment default', async () => {
		await request('PATCH', { syncPerMinute: null });
		expect(mocks.update).toHaveBeenCalledWith({ syncPerMinute: null });
	});
});
