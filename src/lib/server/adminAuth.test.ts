import { afterEach, describe, expect, it, vi } from 'vitest';
import { privateEnv } from '../../tests/env';
import { isAdminAuthorized, timingSafeStringEqual, unauthorizedAdminResponse } from './adminAuth';

describe('admin auth', () => {
	afterEach(() => {
		delete privateEnv.SCRAPSCACHE_ADMIN_TOKEN;
	});

	it('accepts only the exact bearer token', () => {
		const request = new Request('https://example.test/api/admin/status', {
			headers: { authorization: 'Bearer secret-token' }
		});
		expect(isAdminAuthorized(request, 'secret-token')).toBe(true);
		expect(isAdminAuthorized(request, 'other-token')).toBe(false);
		expect(isAdminAuthorized(request, '')).toBe(false);
	});

	it('rejects missing or malformed authorization headers', () => {
		expect(isAdminAuthorized(new Request('https://example.test'), 'secret-token')).toBe(false);
		expect(
			isAdminAuthorized(
				new Request('https://example.test', { headers: { authorization: 'secret-token' } }),
				'secret-token'
			)
		).toBe(false);
	});

	it('compares tokens in constant time without leaking length mismatches', () => {
		expect(timingSafeStringEqual('abc', 'abc')).toBe(true);
		expect(timingSafeStringEqual('abc', 'abd')).toBe(false);
		expect(timingSafeStringEqual('abc', 'ab')).toBe(false);
		expect(timingSafeStringEqual('', 'token')).toBe(false);
	});

	it('hides admin endpoints as 404', async () => {
		const response = unauthorizedAdminResponse();
		expect(response.status).toBe(404);
		await expect(response.text()).resolves.toBe('Not found\n');
	});

	it('fails closed when no admin token is configured', () => {
		const request = new Request('https://example.test/api/admin/status', {
			headers: { authorization: 'Bearer secret-token' }
		});
		expect(isAdminAuthorized(request)).toBe(false);
		privateEnv.SCRAPSCACHE_ADMIN_TOKEN = '';
		expect(isAdminAuthorized(request)).toBe(false);
		privateEnv.SCRAPSCACHE_ADMIN_TOKEN = 'secret-token';
		expect(isAdminAuthorized(request)).toBe(true);
	});
});

describe('requireAdmin', () => {
	afterEach(() => {
		vi.resetModules();
		vi.doUnmock('#lib/server/cloudflareAccess.js');
		vi.doUnmock('#lib/server/rateLimit.js');
	});

	async function guard(options: { access: boolean; allowed?: boolean }) {
		vi.resetModules();
		const passedCloudflareAccess = vi.fn(async () => options.access);
		vi.doMock('#lib/server/cloudflareAccess.js', () => ({ passedCloudflareAccess }));
		vi.doMock('#lib/server/rateLimit.js', () => ({
			checkAdminApiLimit: async () => ({ allowed: options.allowed ?? true }),
			rateLimitResponse: () => new Response(null, { status: 429 })
		}));
		const { requireAdmin } = await import('./adminAuth');
		return { requireAdmin, passedCloudflareAccess };
	}

	const call = (requireAdmin: typeof import('./adminAuth').requireAdmin, token?: string) =>
		requireAdmin(
			new Request('https://admin.example.test/api/admin/status', {
				headers: token ? { authorization: `Bearer ${token}` } : {}
			}),
			() => '203.0.113.4'
		);

	it('admits a request Cloudflare Access let through, with no token set at all', async () => {
		const { requireAdmin } = await guard({ access: true });
		expect(await call(requireAdmin)).toBeNull();
	});

	it('still admits the token, and refuses with neither', async () => {
		privateEnv.SCRAPSCACHE_ADMIN_TOKEN = 'secret-token';
		const { requireAdmin, passedCloudflareAccess } = await guard({ access: false });

		expect(await call(requireAdmin, 'secret-token')).toBeNull();
		expect(passedCloudflareAccess).not.toHaveBeenCalled();
		expect((await call(requireAdmin, 'wrong'))?.status).toBe(404);
		expect((await call(requireAdmin))?.status).toBe(404);
	});

	it('throttles before either check', async () => {
		const { requireAdmin, passedCloudflareAccess } = await guard({ access: true, allowed: false });
		expect((await call(requireAdmin))?.status).toBe(429);
		expect(passedCloudflareAccess).not.toHaveBeenCalled();
	});
});
