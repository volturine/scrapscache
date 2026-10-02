import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import {
	getSyncStore,
	MAX_SYNC_MUTATIONS_PER_REQUEST,
	SyncQuotaExceededError
} from '#lib/server/syncStore.js';
import { getSyncAuth } from '#lib/server/syncAuth.js';
import { readJsonBody } from '#lib/server/request.js';
import {
	clientAddress,
	enterSyncRequest,
	getPublicApiLimiter,
	rateLimitResponse
} from '#lib/server/rateLimit.js';
import { getRuntimeSettings } from '#lib/server/runtimeSettings.js';
import { recordSqliteError, recordSyncBatch, recordSyncPhases } from '#lib/server/metrics.js';
import { Schema } from 'effect';

// Clients re-encode attachments to ~4 MiB before upload (imageOptimize.ts);
// 16 MB leaves ample headroom for base64 expansion and encoding variance.
const MAX_ENVELOPE_BYTES = 16_000_000;
const MAX_REQUEST_BYTES = MAX_ENVELOPE_BYTES + 1_000_000;
const DEFAULT_DOWNLOAD_LIMIT = 12;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const HEX64_PATTERN = /^[a-f0-9]{64}$/;

const OpaqueEnvelopeSchema = Schema.Struct({
	id: Schema.String.pipe(
		Schema.check(Schema.isMaxLength(128)),
		Schema.check(Schema.isPattern(BASE64URL_PATTERN))
	),
	ciphertext: Schema.String.pipe(
		Schema.check(Schema.isMaxLength(MAX_ENVELOPE_BYTES)),
		Schema.check(Schema.isPattern(BASE64URL_PATTERN))
	),
	slot: Schema.String.pipe(Schema.check(Schema.isPattern(HEX64_PATTERN))),
	expectedId: Schema.NullOr(
		Schema.String.pipe(
			Schema.check(Schema.isMaxLength(128)),
			Schema.check(Schema.isPattern(BASE64URL_PATTERN))
		)
	),
	continues: Schema.optional(Schema.Boolean)
});

const OpaqueDeleteSchema = Schema.Struct({
	id: Schema.String.pipe(
		Schema.check(Schema.isMaxLength(128)),
		Schema.check(Schema.isPattern(BASE64URL_PATTERN))
	),
	slot: Schema.String.pipe(Schema.check(Schema.isPattern(HEX64_PATTERN)))
});

type OpaqueEnvelope = Schema.Schema.Type<typeof OpaqueEnvelopeSchema>;
type OpaqueDelete = Schema.Schema.Type<typeof OpaqueDeleteSchema>;

const isOpaqueEnvelope = Schema.is(OpaqueEnvelopeSchema);
const isOpaqueDelete = Schema.is(OpaqueDeleteSchema);

/** Current-state opaque relay: each keyed slot holds one latest ciphertext only. */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const addressLimit = await getPublicApiLimiter().check(
		`sync-ip:${clientAddress(getClientAddress)}`,
		{
			capacity: 120,
			refillWindowMs: 60_000
		}
	);
	if (!addressLimit.allowed) return rateLimitResponse(addressLimit);
	const settings = await getRuntimeSettings();
	const release = enterSyncRequest(settings.maxConcurrentSyncRequests);
	if (!release) {
		return json({ error: 'Sync server is busy' }, { status: 503, headers: { 'retry-after': '2' } });
	}
	try {
		const accountId = await getSyncAuth().authenticateSyncRequest(request);
		if (!accountId) return json({ error: 'Invalid sync session' }, { status: 401 });
		let body: {
			cursor?: unknown;
			envelopes?: unknown;
			deleteSlots?: unknown;
			limit?: unknown;
		};
		try {
			body = (await readJsonBody(request, MAX_REQUEST_BYTES)) as typeof body;
		} catch {
			return json({ error: 'Invalid JSON body' }, { status: 400 });
		}
		const cursor =
			typeof body.cursor === 'number' && Number.isInteger(body.cursor) && body.cursor >= 0
				? body.cursor
				: 0;
		const envelopes = body.envelopes == null ? [] : body.envelopes;
		if (
			!Array.isArray(envelopes) ||
			envelopes.length > MAX_SYNC_MUTATIONS_PER_REQUEST ||
			!envelopes.every(isOpaqueEnvelope)
		) {
			return json({ error: 'Invalid encrypted envelope batch' }, { status: 400 });
		}
		const deleteSlots = body.deleteSlots == null ? [] : body.deleteSlots;
		if (
			!Array.isArray(deleteSlots) ||
			deleteSlots.length > MAX_SYNC_MUTATIONS_PER_REQUEST ||
			!deleteSlots.every(isOpaqueDelete)
		) {
			return json({ error: 'Invalid encrypted deletion batch' }, { status: 400 });
		}
		const limit =
			typeof body.limit === 'number' && Number.isInteger(body.limit) && body.limit > 0
				? Math.min(body.limit, 50)
				: DEFAULT_DOWNLOAD_LIMIT;
		recordSyncBatch(envelopes.length, deleteSlots.length);
		const senderClientId = request.headers.get('x-sync-client-id') ?? undefined;
		try {
			const store = getSyncStore();
			// One relay read per sync, to pick up an operator override. Deliberately
			// not cached and not carried on the session: the session lives in the ops
			// store and the override in the relay, which are separate databases when
			// self-hosted, so there is nothing to join it onto. This runs only after
			// authentication, on a path that already makes several calls.
			const accountLimit = await getPublicApiLimiter().check(`sync-account:${accountId}`, {
				capacity: (await store.accountRateLimit(accountId)) ?? settings.syncPerMinute,
				refillWindowMs: 60_000
			});
			if (!accountLimit.allowed) return rateLimitResponse(accountLimit);
			const { phaseTimings, ...result } = await store.sync(
				accountId,
				cursor,
				envelopes,
				deleteSlots,
				limit,
				senderClientId,
				settings.maxAccountBytes
			);
			if (phaseTimings) recordSyncPhases(phaseTimings);
			// Writers stamp edits on this clock, so device clock skew cannot decide conflicts.
			return json({ ...result, serverTime: Date.now() });
		} catch (error) {
			recordSqliteError(error);
			if (error instanceof SyncQuotaExceededError) {
				return json({ error: 'Sync account storage quota exceeded' }, { status: 507 });
			}
			console.error('[sync] current-state relay failed:', error);
			return json({ error: 'Sync storage is temporarily unavailable' }, { status: 503 });
		}
	} finally {
		release();
	}
};
