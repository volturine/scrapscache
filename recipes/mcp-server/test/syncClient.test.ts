import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ScrapscacheSyncClient } from '../src/syncClient.js';
import { bytesToBase64Url, identityFromSyncKey, randomBytes } from '../src/crypto.js';

describe('ScrapscacheSyncClient', () => {
	const syncKey = bytesToBase64Url(randomBytes(32));
	const baseUrl = 'https://notes.example.com';

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('successfully authenticates via challenge and fetches delta', async () => {
		const client = new ScrapscacheSyncClient(baseUrl, syncKey);

		let challengeCalled = false;
		let sessionCalled = false;
		let deltaCalled = false;

		globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const urlStr = typeof input === 'string' ? input : input.toString();

			if (urlStr.includes('/api/sync/auth/challenge')) {
				challengeCalled = true;
				expect(init?.method).toBe('POST');
				expect((init?.headers as Record<string, string>)?.['Content-Type']).toBe(
					'application/json'
				);
				expect(JSON.parse(String(init?.body || '{}'))).toEqual({
					accountId: identityFromSyncKey(syncKey).accountId
				});
				return new Response(
					JSON.stringify({ challengeId: 'chal_123', challenge: 'sample_challenge_nonce' }),
					{ status: 200, headers: { 'Content-Type': 'application/json' } }
				);
			}

			if (urlStr.includes('/api/sync/auth/session')) {
				sessionCalled = true;
				const body = JSON.parse(String(init?.body || '{}'));
				expect(body.challengeId).toBe('chal_123');
				expect(body.signature).toBeDefined();
				return new Response(
					JSON.stringify({ accessToken: 'test_token_abc', expiresAt: Date.now() + 3600_000 }),
					{ status: 200, headers: { 'Content-Type': 'application/json' } }
				);
			}

			if (urlStr.includes('/api/sync/delta')) {
				deltaCalled = true;
				const authHeader = (init?.headers as Record<string, string>)?.['Authorization'] || '';
				expect(authHeader).toBe('Bearer test_token_abc');
				return new Response(
					JSON.stringify({
						cursor: 10,
						envelopes: [],
						conflicts: [],
						hasMore: false,
						reset: false,
						writesAccepted: true
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } }
				);
			}

			return new Response('Not Found', { status: 404 });
		}) as unknown as typeof fetch;

		const result = await client.syncDelta(0);
		expect(challengeCalled).toBe(true);
		expect(sessionCalled).toBe(true);
		expect(deltaCalled).toBe(true);
		expect(result.cursor).toBe(10);
		expect(result.writesAccepted).toBe(true);
	});

	it('automatically re-authenticates if delta returns 401', async () => {
		const client = new ScrapscacheSyncClient(baseUrl, syncKey);

		let deltaAttempts = 0;
		let authCount = 0;

		globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
			const urlStr = typeof input === 'string' ? input : input.toString();

			if (urlStr.includes('/api/sync/auth/challenge')) {
				return new Response(
					JSON.stringify({ challengeId: `chal_${authCount}`, challenge: 'nonce' }),
					{ status: 200, headers: { 'Content-Type': 'application/json' } }
				);
			}

			if (urlStr.includes('/api/sync/auth/session')) {
				authCount += 1;
				return new Response(
					JSON.stringify({ accessToken: `token_${authCount}`, expiresAt: Date.now() + 3600_000 }),
					{ status: 200, headers: { 'Content-Type': 'application/json' } }
				);
			}

			if (urlStr.includes('/api/sync/delta')) {
				deltaAttempts += 1;
				if (deltaAttempts === 1) {
					return new Response('Unauthorized', { status: 401 });
				}
				return new Response(JSON.stringify({ cursor: 5, envelopes: [], hasMore: false }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			}

			return new Response('Not Found', { status: 404 });
		}) as unknown as typeof fetch;

		const result = await client.syncDelta(0);
		expect(authCount).toBe(2);
		expect(deltaAttempts).toBe(2);
		expect(result.cursor).toBe(5);
	});
});
