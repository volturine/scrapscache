import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ScrapscacheSyncClient } from '../src/syncClient.js';
import { bytesToBase64Url, identityFromSyncKey, randomBytes } from '../src/crypto.js';
import {
	SYNC_DELTA_PATH,
	SYNC_PROTOCOL_HEADER,
	SYNC_PROTOCOL_VERSION
} from '../../../src/lib/model/protocol.js';

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

			if (urlStr.includes(SYNC_DELTA_PATH)) {
				deltaCalled = true;
				const authHeader = (init?.headers as Record<string, string>)?.['Authorization'] || '';
				expect(authHeader).toBe('Bearer test_token_abc');
				expect(new Headers(init?.headers).get(SYNC_PROTOCOL_HEADER)).toBe(SYNC_PROTOCOL_VERSION);
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

			if (urlStr.includes(SYNC_DELTA_PATH)) {
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

	it('does not retry authentication when delta requires a newer protocol', async () => {
		const client = new ScrapscacheSyncClient(baseUrl, syncKey);
		let deltaAttempts = 0;
		let authCount = 0;

		globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const urlStr = typeof input === 'string' ? input : input.toString();
			if (urlStr.includes('/api/sync/auth/challenge')) {
				return new Response(JSON.stringify({ challengeId: 'chal', challenge: 'nonce' }), {
					status: 200
				});
			}
			if (urlStr.includes('/api/sync/auth/session')) {
				authCount += 1;
				return new Response(
					JSON.stringify({ accessToken: 'token', expiresAt: Date.now() + 3600_000 }),
					{ status: 200 }
				);
			}
			if (urlStr.includes(SYNC_DELTA_PATH)) {
				deltaAttempts += 1;
				expect(new Headers(init?.headers).get(SYNC_PROTOCOL_HEADER)).toBe(SYNC_PROTOCOL_VERSION);
				return Response.json(
					{
						error: 'Sync protocol version mismatch. Reload the app or update the MCP server.',
						requiredVersion: SYNC_PROTOCOL_VERSION
					},
					{ status: 409 }
				);
			}
			return new Response('Not Found', { status: 404 });
		}) as typeof fetch;

		await expect(client.syncDelta(0)).rejects.toThrow('status 409');
		expect(authCount).toBe(1);
		expect(deltaAttempts).toBe(1);
	});

	it('explains that an older relay needs an update when the v2 route is missing', async () => {
		const client = new ScrapscacheSyncClient(baseUrl, syncKey);
		let authCount = 0;
		let deltaAttempts = 0;

		globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
			const urlStr = typeof input === 'string' ? input : input.toString();
			if (urlStr.includes('/api/sync/auth/challenge')) {
				return new Response(JSON.stringify({ challengeId: 'chal', challenge: 'nonce' }), {
					status: 200
				});
			}
			if (urlStr.includes('/api/sync/auth/session')) {
				authCount += 1;
				return Response.json({ accessToken: 'token', expiresAt: Date.now() + 3600_000 });
			}
			if (urlStr.includes(SYNC_DELTA_PATH)) {
				deltaAttempts += 1;
				return new Response('Not Found', { status: 404 });
			}
			return new Response('Not Found', { status: 404 });
		}) as typeof fetch;

		await expect(client.syncDelta(0)).rejects.toThrow(
			'The sync server needs an update to support this app version.'
		);
		expect(authCount).toBe(1);
		expect(deltaAttempts).toBe(1);
	});

	it('publishes reminder wakes under the sync session and reports a stale snapshot', async () => {
		const client = new ScrapscacheSyncClient(baseUrl, syncKey);
		const wake = { id: 'a'.repeat(43), fireAt: 1_900_000_000_000 };
		const bodies: unknown[] = [];
		let status = 200;

		globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const urlStr = typeof input === 'string' ? input : input.toString();
			if (urlStr.includes('/api/sync/auth/challenge')) {
				return new Response(JSON.stringify({ challengeId: 'chal', challenge: 'nonce' }), {
					status: 200
				});
			}
			if (urlStr.includes('/api/sync/auth/session')) {
				return new Response(
					JSON.stringify({ accessToken: 'token', expiresAt: Date.now() + 3600_000 }),
					{ status: 200 }
				);
			}
			expect(urlStr).toBe(`${baseUrl}/api/sync/push/wakes`);
			expect(init?.method).toBe('PUT');
			expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token');
			bodies.push(JSON.parse(String(init?.body)));
			return new Response(null, { status });
		}) as typeof fetch;

		expect(await client.putReminderWakes(7, [wake])).toBe(true);
		expect(bodies).toEqual([{ revision: 7, wakes: [wake] }]);
		status = 409;
		expect(await client.putReminderWakes(6, [])).toBe(false);
		status = 503;
		await expect(client.putReminderWakes(8, [])).rejects.toThrow('status 503');
	});
});
