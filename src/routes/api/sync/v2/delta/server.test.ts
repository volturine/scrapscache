import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	SYNC_DELTA_PATH,
	SYNC_PROTOCOL_HEADER,
	SYNC_PROTOCOL_VERSION
} from '#lib/model/protocol.js';

const mocks = vi.hoisted(() => {
	class QuotaError extends Error {}
	return {
		QuotaError,
		authenticate: vi.fn((): string | null => 'account-123456789'),
		sync: vi.fn(),
		chargeSyncChurn: vi.fn(
			async (
				_accountId: string,
				_mutations: number
			): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> => ({
				allowed: true
			})
		),
		accountRateLimit: vi.fn(async (): Promise<number | null> => null),
		enterSyncRequest: vi.fn(() => vi.fn()),
		enterSyncBody: vi.fn(() => vi.fn()),
		settings: {
			maxAccountBytes: 5_000,
			syncPerMinute: 12,
			maxConcurrentSyncRequests: 3,
			retentionInactiveDays: 365,
			allowIndexing: false,
			vapidSubject: 'mailto:test@example.com'
		},
		limitChecks: vi.fn<(key: string, policy?: unknown) => { allowed: true }>(() => ({
			allowed: true
		}))
	};
});

vi.mock('#lib/server/syncStore.js', () => ({
	SyncQuotaExceededError: mocks.QuotaError,
	MAX_SYNC_MUTATIONS_PER_REQUEST: 2_000,
	getSyncStore: () => ({
		sync: mocks.sync,
		accountRateLimit: mocks.accountRateLimit
	})
}));
vi.mock('#lib/server/syncAuth.js', () => ({
	getSyncAuth: () => ({ authenticateSyncRequest: mocks.authenticate })
}));
vi.mock('#lib/server/rateLimit.js', () => ({
	chargeSyncChurn: mocks.chargeSyncChurn,
	clientAddress: () => '127.0.0.1',
	enterSyncRequest: mocks.enterSyncRequest,
	enterSyncBody: mocks.enterSyncBody,
	SYNC_BODY_SLOTS_PER_SYNC_SLOT: 2,
	getPublicApiLimiter: () => ({
		check: (key: string, policy: unknown) => mocks.limitChecks(key, policy)
	}),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));
vi.mock('#lib/server/runtimeSettings.js', () => ({
	getRuntimeSettings: async () => mocks.settings
}));
vi.mock('#lib/server/metrics.js', () => ({
	recordSqliteError: vi.fn(),
	recordSyncBatch: vi.fn()
}));

import { POST } from './+server';

const accountId = 'account-123456789';

const validEnvelope = {
	id: 'envelope-id',
	slot: 'a'.repeat(64),
	expectedId: null,
	ciphertext: 'opaque'
};

function handle(request: Request): Promise<Response> {
	return (
		POST as unknown as (event: {
			request: Request;
			getClientAddress(): string;
		}) => Promise<Response>
	)({ request, getClientAddress: () => '127.0.0.1' });
}

function deltaRequest(
	body: string,
	protocolVersion: string | null = SYNC_PROTOCOL_VERSION
): Request {
	const headers = new Headers({
		'content-type': 'application/json',
		authorization: 'Bearer token'
	});
	if (protocolVersion !== null) headers.set(SYNC_PROTOCOL_HEADER, protocolVersion);
	return new Request(new URL(SYNC_DELTA_PATH, 'http://localhost'), {
		method: 'POST',
		headers,
		body
	});
}

function postRaw(body: string): Promise<Response> {
	return handle(deltaRequest(body));
}

function post(body: unknown): Promise<Response> {
	return postRaw(JSON.stringify(body));
}

describe('sync delta route', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.limitChecks.mockImplementation(() => ({ allowed: true }));
		mocks.chargeSyncChurn.mockImplementation(async () => ({ allowed: true }));
		mocks.authenticate.mockReturnValue(accountId);
		mocks.sync.mockReturnValue({
			cursor: 2,
			envelopes: [],
			conflicts: [],
			hasMore: false,
			reset: false,
			writesAccepted: true,
			usage: { envelopeCount: 2, ciphertextBytes: 12, storageBytes: 1_036, maxBytes: 2_000 }
		});
	});

	it.each([
		['missing', null],
		['wrong', '1']
	] as const)(
		'rejects a %s protocol version before authentication or body processing',
		async (_kind, version) => {
			const request = deltaRequest('{not json', version);
			const response = await handle(request);

			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error: 'Sync protocol version mismatch. Reload the app or update the MCP server.',
				requiredVersion: SYNC_PROTOCOL_VERSION
			});
			expect(mocks.limitChecks).toHaveBeenCalledWith('sync-ip:127.0.0.1', {
				capacity: 120,
				refillWindowMs: 60_000
			});
			expect(mocks.limitChecks).toHaveBeenCalledOnce();
			expect(mocks.authenticate).not.toHaveBeenCalled();
			expect(request.bodyUsed).toBe(false);
			expect(mocks.accountRateLimit).not.toHaveBeenCalled();
			expect(mocks.enterSyncBody).not.toHaveBeenCalled();
			expect(mocks.enterSyncRequest).not.toHaveBeenCalled();
			expect(mocks.sync).not.toHaveBeenCalled();
		}
	);

	it('passes validated conditional writes and bounded cursors to the relay', async () => {
		const replacement = {
			...validEnvelope,
			id: 'replacement',
			expectedId: 'current-id',
			continues: true
		};
		const response = await post({
			cursor: -1,
			limit: 999,
			envelopes: [validEnvelope, replacement],
			deleteSlots: [{ id: 'deleted-id', slot: 'b'.repeat(64) }]
		});

		expect(response.status).toBe(200);
		expect(mocks.sync).toHaveBeenCalledWith(
			accountId,
			0,
			[validEnvelope, replacement],
			[{ id: 'deleted-id', slot: 'b'.repeat(64) }],
			50,
			undefined,
			5_000
		);
		// Clients stamp edits on the relay clock, so it answers with its time.
		expect(await response.json()).toMatchObject({
			writesAccepted: true,
			conflicts: [],
			serverTime: expect.any(Number)
		});
	});

	it('charges the account’s daily churn allowance one token per write', async () => {
		await post({
			envelopes: [validEnvelope, { ...validEnvelope, id: 'second', slot: 'c'.repeat(64) }],
			deleteSlots: [{ id: 'deleted-id', slot: 'b'.repeat(64) }]
		});
		expect(mocks.chargeSyncChurn).toHaveBeenCalledWith(accountId, 3);
	});

	it('leaves the churn allowance alone for a round that writes nothing', async () => {
		const response = await post({ envelopes: [], deleteSlots: [] });
		expect(response.status).toBe(200);
		expect(mocks.chargeSyncChurn).not.toHaveBeenCalled();
	});

	it('refuses writes once the account’s churn allowance is spent, before taking a sync slot', async () => {
		mocks.chargeSyncChurn.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
		const response = await post({ envelopes: [validEnvelope], deleteSlots: [] });
		expect(response.status).toBe(429);
		expect(mocks.enterSyncRequest).not.toHaveBeenCalled();
		expect(mocks.sync).not.toHaveBeenCalled();
	});

	it.each([1, 'yes', null])('rejects a continues flag of %s', async (continues) => {
		const response = await post({ envelopes: [{ ...validEnvelope, continues }], deleteSlots: [] });

		expect(response.status).toBe(400);
		expect(mocks.sync).not.toHaveBeenCalled();
	});

	it.each([
		['missing', undefined],
		['wrong type', 3],
		['invalid characters', 'not valid'],
		['too long', 'x'.repeat(129)]
	])('rejects an expectedId that is %s', async (_label, expectedId) => {
		const envelope = { ...validEnvelope } as Record<string, unknown>;
		if (expectedId !== undefined) envelope.expectedId = expectedId;
		else delete envelope.expectedId;

		const response = await post({ envelopes: [envelope], deleteSlots: [] });

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Invalid encrypted envelope batch' });
		expect(mocks.sync).not.toHaveBeenCalled();
	});

	it('rejects batches above the public protocol boundary', async () => {
		const envelopes = Array.from({ length: 2_001 }, (_, index) => ({
			...validEnvelope,
			id: `envelope-${index}`
		}));
		const response = await post({ envelopes, deleteSlots: [] });

		expect(response.status).toBe(400);
		expect(mocks.sync).not.toHaveBeenCalled();
	});

	it.each([
		['an empty id', { id: '' }],
		['an id over 128 characters', { id: 'a'.repeat(129) }],
		['an id outside base64url', { id: 'envelope/id' }],
		['a slot that is not a SHA-256 hex digest', { slot: 'A'.repeat(64) }],
		['ciphertext outside base64url', { ciphertext: 'opaque+data=' }],
		['empty ciphertext', { ciphertext: '' }],
		['an expected id outside base64url', { expectedId: 'current id' }],
		['no expected id at all', { expectedId: undefined }],
		['a non-boolean continuation flag', { continues: 'yes' }],
		['a numeric id', { id: 42 }]
	])('rejects an envelope with %s', async (_label, change) => {
		const response = await post({ envelopes: [{ ...validEnvelope, ...change }], deleteSlots: [] });

		expect(response.status).toBe(400);
		expect(mocks.sync).not.toHaveBeenCalled();
	});

	it('rejects ciphertext over the envelope cap', async () => {
		const response = await post({
			envelopes: [{ ...validEnvelope, ciphertext: 'a'.repeat(16_000_001) }],
			deleteSlots: []
		});

		expect(response.status).toBe(400);
		expect(mocks.sync).not.toHaveBeenCalled();
	});

	it.each([
		['empty id', { id: '', slot: 'b'.repeat(64) }],
		['non-hash slot', { id: 'deleted-id', slot: 'not-a-slot' }]
	])('rejects an invalid deletion with %s', async (_label, deletion) => {
		const response = await post({ envelopes: [], deleteSlots: [deletion] });

		expect(response.status).toBe(400);
		expect(mocks.sync).not.toHaveBeenCalled();
	});

	it('rejects an invalid or expired session', async () => {
		mocks.authenticate.mockReturnValue(null);
		const response = await post({ envelopes: [], deleteSlots: [] });

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'Invalid sync session' });
	});

	it('consumes the per-account bucket only after session authentication', async () => {
		mocks.authenticate.mockReturnValue(null);
		await post({ envelopes: [], deleteSlots: [] });
		expect(mocks.limitChecks.mock.calls.map(([key]) => key)).toEqual(['sync-ip:127.0.0.1']);

		mocks.authenticate.mockReturnValue(accountId);
		await post({ envelopes: [], deleteSlots: [] });
		expect(mocks.limitChecks.mock.calls.map(([key]) => key)).toEqual([
			'sync-ip:127.0.0.1',
			'sync-ip:127.0.0.1',
			'sync-account:account-123456789'
		]);
	});

	it('uses an operator override for the per-account budget', async () => {
		mocks.accountRateLimit.mockResolvedValueOnce(240);

		await post({ cursor: 0, envelopes: [validEnvelope] });

		expect(mocks.limitChecks).toHaveBeenCalledWith(`sync-account:${accountId}`, {
			capacity: 240,
			refillWindowMs: 60_000
		});
	});

	it('falls back to the shared budget when the account has no override', async () => {
		mocks.accountRateLimit.mockResolvedValueOnce(null);

		await post({ cursor: 0, envelopes: [validEnvelope] });

		expect(mocks.limitChecks).toHaveBeenCalledWith(`sync-account:${accountId}`, {
			capacity: 12,
			refillWindowMs: 60_000
		});
	});

	it('holds a body slot only while the body is read, releasing it before the sync slot', async () => {
		const releaseBody = vi.fn();
		mocks.enterSyncBody.mockReturnValueOnce(releaseBody);
		mocks.enterSyncRequest.mockImplementationOnce(() => {
			// Taking the sync slot comes after the body is parsed and its slot is free.
			expect(releaseBody).toHaveBeenCalledOnce();
			return vi.fn();
		});

		const response = await post({ envelopes: [validEnvelope] });

		expect(response.status).toBe(200);
		expect(mocks.enterSyncBody).toHaveBeenCalledWith(6);
		expect(mocks.enterSyncRequest).toHaveBeenCalledOnce();
		expect(mocks.enterSyncBody.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.enterSyncRequest.mock.invocationCallOrder[0]
		);
	});

	it('releases the body slot when the body is malformed', async () => {
		const releaseBody = vi.fn();
		mocks.enterSyncBody.mockReturnValueOnce(releaseBody);
		expect((await postRaw('{not json')).status).toBe(400);
		expect(releaseBody).toHaveBeenCalledOnce();
		expect(mocks.enterSyncRequest).not.toHaveBeenCalled();
	});

	it('answers busy before reading a byte when every body slot is taken', async () => {
		mocks.enterSyncBody.mockReturnValueOnce(null as never);
		const request = deltaRequest(JSON.stringify({ envelopes: [validEnvelope] }));

		const response = await handle(request);

		expect(response.status).toBe(503);
		expect(response.headers.get('retry-after')).toBe('2');
		expect(request.bodyUsed).toBe(false);
		expect(mocks.enterSyncRequest).not.toHaveBeenCalled();
		expect(mocks.sync).not.toHaveBeenCalled();
	});

	it('takes a sync slot under the runtime limit and releases it after the round', async () => {
		const release = vi.fn();
		mocks.enterSyncRequest.mockReturnValueOnce(release);
		const response = await post({ envelopes: [], deleteSlots: [] });
		expect(response.status).toBe(200);
		expect(mocks.enterSyncRequest).toHaveBeenCalledWith(3);
		expect(release).toHaveBeenCalledOnce();
	});

	it('answers busy without touching the relay when every slot is taken', async () => {
		mocks.enterSyncRequest.mockReturnValueOnce(null as never);
		const response = await post({ envelopes: [validEnvelope] });
		expect(response.status).toBe(503);
		expect(response.headers.get('retry-after')).toBe('2');
		expect(mocks.sync).not.toHaveBeenCalled();
	});

	it('takes no sync slot until the session, account budget and whole body pass', async () => {
		mocks.authenticate.mockReturnValueOnce(null);
		expect((await post({ envelopes: [] })).status).toBe(401);

		mocks.limitChecks.mockImplementation((key) =>
			key.startsWith('sync-account:') ? ({ allowed: false } as never) : { allowed: true }
		);
		expect((await post({ envelopes: [] })).status).toBe(429);
		mocks.limitChecks.mockImplementation(() => ({ allowed: true }));
		mocks.chargeSyncChurn.mockImplementation(async () => ({ allowed: true }));

		expect((await post({ envelopes: [{ ...validEnvelope, id: '' }] })).status).toBe(400);
		expect((await postRaw('{not json')).status).toBe(400);

		expect(mocks.enterSyncRequest).not.toHaveBeenCalled();
	});

	it('reads the body only after the session is authenticated', async () => {
		mocks.authenticate.mockReturnValueOnce(null);
		const request = deltaRequest(JSON.stringify({ envelopes: [] }));
		const response = await handle(request);
		expect(response.status).toBe(401);
		expect(request.bodyUsed).toBe(false);
	});

	it('maps an atomic relay quota rejection to HTTP 507', async () => {
		mocks.sync.mockImplementation(() => {
			throw new mocks.QuotaError();
		});
		const response = await post({ envelopes: [], deleteSlots: [] });

		expect(response.status).toBe(507);
		expect(await response.json()).toEqual({ error: 'Sync account storage quota exceeded' });
	});
});
