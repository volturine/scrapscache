import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	requireAdmin: vi.fn(async (): Promise<Response | null> => null),
	listFeatureFlags: vi.fn(async () => [
		{ flag: 'canvas-beta', defaultEnabled: false, description: 'Unreleased canvas' }
	]),
	upsertFeatureFlag: vi.fn(async () => undefined),
	deleteFeatureFlag: vi.fn(async () => true)
}));

vi.mock('$lib/server/adminAuth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('$lib/server/syncStore', () => ({ getSyncStore: () => mocks }));

import { DELETE, GET, PUT } from './+server';

type Handler = (event: { request: Request; getClientAddress(): string }) => Promise<Response>;

function call(handler: unknown, method: string, body?: unknown): Promise<Response> {
	return (handler as Handler)({
		request: new Request('https://example.test/api/admin/flags', {
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
	mocks.deleteFeatureFlag.mockResolvedValue(true);
});

describe('the gate registry', () => {
	it('lists what exists', async () => {
		const response = await call(GET, 'GET');
		expect(await response.json()).toMatchObject({ flags: [{ flag: 'canvas-beta' }] });
	});

	it('declares a gate and answers with the registry as it now stands', async () => {
		const response = await call(PUT, 'PUT', {
			flag: 'canvas-beta',
			defaultEnabled: true,
			description: 'Unreleased canvas'
		});

		expect(response.status).toBe(200);
		expect(mocks.upsertFeatureFlag).toHaveBeenCalledWith('canvas-beta', true, 'Unreleased canvas');
		expect(await response.json()).toHaveProperty('flags');
	});

	it('keeps flag names to something that can live in a URL and a column', async () => {
		for (const flag of ['Canvas Beta', 'canvas_beta', '-leading', 'x'.repeat(65), '']) {
			expect((await call(PUT, 'PUT', { flag, defaultEnabled: true })).status).toBe(400);
		}
		expect(mocks.upsertFeatureFlag).not.toHaveBeenCalled();
	});

	it('insists the default is a decision rather than whatever was sent', async () => {
		expect((await call(PUT, 'PUT', { flag: 'beta' })).status).toBe(400);
		expect((await call(PUT, 'PUT', { flag: 'beta', defaultEnabled: 'yes' })).status).toBe(400);
		expect(mocks.upsertFeatureFlag).not.toHaveBeenCalled();
	});

	it('ends a rollout', async () => {
		const response = await call(DELETE, 'DELETE', { flag: 'canvas-beta' });
		expect(response.status).toBe(200);
		expect(mocks.deleteFeatureFlag).toHaveBeenCalledWith('canvas-beta');
	});

	it('says so when the gate was never declared', async () => {
		mocks.deleteFeatureFlag.mockResolvedValue(false);
		expect((await call(DELETE, 'DELETE', { flag: 'canvas-beta' })).status).toBe(404);
	});

	it('hides the whole registry behind the admin guard', async () => {
		mocks.requireAdmin.mockResolvedValue(new Response(null, { status: 404 }));
		expect((await call(GET, 'GET')).status).toBe(404);
		expect((await call(PUT, 'PUT', { flag: 'beta', defaultEnabled: true })).status).toBe(404);
		expect(mocks.listFeatureFlags).not.toHaveBeenCalled();
		expect(mocks.upsertFeatureFlag).not.toHaveBeenCalled();
	});
});
