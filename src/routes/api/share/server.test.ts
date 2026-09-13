import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	create: vi.fn(
		async (_params: { ciphertext: string; burnAfterReading?: boolean; expiresInMs?: number }) => ({
			id: 'mock-share-id-123',
			expiresAt: 1700086400000
		})
	),
	get: vi.fn(async (id: string) => {
		if (id === 'existing-id') {
			return {
				id: 'existing-id',
				ciphertext: 'mock-ciphertext',
				burnAfterReading: false,
				expiresAt: 1700086400000
			};
		}
		if (id === 'burn-id') {
			return {
				id: 'burn-id',
				ciphertext: 'mock-burn-ciphertext',
				burnAfterReading: true,
				expiresAt: 1700086400000
			};
		}
		return null;
	}),
	rateLimitAllowed: true
}));

vi.mock('$lib/server/sharedNotes', () => ({
	MAX_CIPHERTEXT_LENGTH: 25 * 1024 * 1024,
	getSharedNotes: () => ({
		create: mocks.create,
		get: mocks.get
	})
}));

vi.mock('$lib/server/rateLimit', () => ({
	clientAddress: () => '192.0.2.1',
	getPublicApiLimiter: () => ({
		check: async () =>
			mocks.rateLimitAllowed ? { allowed: true } : { allowed: false, retryAfterSeconds: 30 }
	}),
	rateLimitResponse: () =>
		new Response(JSON.stringify({ error: 'Too many requests' }), {
			status: 429,
			headers: { 'retry-after': '30' }
		})
}));

import { POST } from './+server';
import { GET } from './[id]/+server';

async function callPost(body: unknown): Promise<Response> {
	return (
		POST as unknown as (event: {
			request: Request;
			getClientAddress(): string;
		}) => Promise<Response>
	)({
		request: new Request('http://localhost/api/share', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: typeof body === 'string' ? body : JSON.stringify(body)
		}),
		getClientAddress: () => '192.0.2.1'
	});
}

async function callGet(id: string): Promise<Response> {
	return (
		GET as unknown as (event: {
			params: { id: string };
			getClientAddress(): string;
		}) => Promise<Response>
	)({
		params: { id },
		getClientAddress: () => '192.0.2.1'
	});
}

describe('/api/share endpoints', () => {
	beforeEach(() => {
		mocks.rateLimitAllowed = true;
		mocks.create.mockClear();
		mocks.get.mockClear();
	});

	it('creates a shared note successfully', async () => {
		const res = await callPost({
			ciphertext: 'valid-base64url-ciphertext',
			burnAfterReading: true,
			expiresInMs: 86400000
		});

		expect(res.status).toBe(201);
		const json = await res.json();
		expect(json).toEqual({
			id: 'mock-share-id-123',
			expiresAt: 1700086400000
		});
		expect(mocks.create).toHaveBeenCalledWith({
			ciphertext: 'valid-base64url-ciphertext',
			burnAfterReading: true,
			expiresInMs: 86400000
		});
	});

	it('rejects POST with missing ciphertext', async () => {
		const res = await callPost({
			ciphertext: '   ',
			burnAfterReading: false
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toContain('ciphertext must be a non-empty string');
	});

	it('returns rate limit 429 when limiter disallows', async () => {
		mocks.rateLimitAllowed = false;
		const res = await callPost({ ciphertext: 'abc' });
		expect(res.status).toBe(429);
	});

	it('retrieves an existing shared note', async () => {
		const res = await callGet('existing-id');
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toContain('no-store');
		const json = await res.json();
		expect(json).toEqual({
			ciphertext: 'mock-ciphertext',
			burnAfterReading: false,
			expiresAt: 1700086400000
		});
	});

	it('returns 404 for missing or already burned note', async () => {
		const res = await callGet('non-existent-id');
		expect(res.status).toBe(404);
		const json = await res.json();
		expect(json.error).toContain('Note not found or expired');
	});
});
