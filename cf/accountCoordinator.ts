import type {
	D1Database,
	DurableObjectState,
	R2Bucket,
	WebSocket as WorkerSocket,
	WebSocketPair as WorkerSocketPair,
	WebSocketRequestResponsePair as WorkerAutoResponse
} from '@cloudflare/workers-types';
import { batch, execute, type SqlStatement, type SqlResult } from '../src/lib/server/cloudflare/d1';
import { parseHistoryVersions } from '../src/lib/server/operatorConfig';
import { createSyncTimings, type SyncTimings } from '../src/lib/server/syncMetrics';
import {
	deleteHistoryRows,
	deleteObjects,
	OLDER_VERSION,
	olderVersions,
	purgeDeletedRecords
} from '../src/lib/server/cloudflare/history';
import { MAX_DOWNLOAD_PAGE_BYTES, fitDownloadPage } from '../src/lib/syncLimits';

type Env = {
	SCRAPSCACHE_DB: D1Database;
	SCRAPSCACHE_ENVELOPES: R2Bucket;
	SCRAPSCACHE_HISTORY_VERSIONS?: string;
};

type Upload = {
	id: string;
	slot: string;
	ciphertext: string;
	expectedId?: string | null;
	/** The upload continues the version it replaces, which then leaves the history. */
	continues?: boolean;
};
type Deletion = { id: string; slot: string };
type EnvelopeRow = {
	seq: number;
	id: string;
	slot: string;
	r2Key: string;
	ciphertextBytes: number;
};
type SyncInput = {
	accountId: string;
	cursor: number;
	uploads: Upload[];
	deletions: Deletion[];
	downloadLimit: number;
	maxAccountBytes: number;
	/** The device that wrote, so its own stream is not woken by its own change. */
	senderClientId?: string;
};

const STORAGE_OVERHEAD_BYTES = 512;
/** Concurrent change sockets one account may hold open. Comfortably above a real
 * user's devices and tabs, and low enough that a session cannot hold this object's
 * connections without bound. */
const MAX_EVENT_SOCKETS = 16;
/** How long one mutating round may hold the write lock before the object resets.
 * Real rounds average about half a second, so this leaves wide headroom, while a
 * round stuck on a call that never returns fails within 30 seconds instead of
 * holding every device's sync spinner and uploads behind it. */
export const MAX_WRITE_ROUND_MS = 30_000;
/** Sent by the client to keep the connection open; the runtime answers it without waking this object. */
export const SOCKET_PING = 'ping';
export const SOCKET_PONG = 'pong';
/** Closes a socket whose sign-in has expired, so the client reconnects with a fresh one. */
export const SOCKET_SESSION_EXPIRED = 4401;
type SocketAttachment = { clientId?: string; expiresAt: number };
/** Workers runtime globals; the types package declares them without providing values. */
const runtime = globalThis as unknown as {
	WebSocketPair: typeof WorkerSocketPair;
	WebSocketRequestResponsePair?: typeof WorkerAutoResponse;
};
const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
	return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function accountPrefix(accountId: string): Promise<string> {
	return hex(await crypto.subtle.digest('SHA-256', encoder.encode(accountId)));
}

async function ciphertext(env: Env, row: EnvelopeRow): Promise<string> {
	const object = await env.SCRAPSCACHE_ENVELOPES.get(row.r2Key);
	if (!object) throw new Error('Encrypted envelope object is missing');
	return object.text();
}

async function hydrated(env: Env, rows: EnvelopeRow[], timings?: SyncTimings) {
	timings?.start('r2_get');
	timings?.count('r2_get', rows.length);
	try {
		return await Promise.all(
			rows.map(async (row) => ({
				seq: row.seq,
				id: row.id,
				slot: row.slot,
				ciphertext: await ciphertext(env, row)
			}))
		);
	} finally {
		timings?.stop('r2_get');
	}
}

/**
 * Live change sockets use the WebSocket Hibernation API: while they sit idle the
 * object can be evicted and is not billed, and heartbeats are answered by the
 * runtime. The object wakes only for uploads, which it serves anyway.
 */
export class AccountCoordinator {
	/**
	 * Mutating rounds and `/delete` must not overlap: each starts from the
	 * account row (next_seq, counters, history usage) and writes back values
	 * computed from it, which two overlapping runs would lose. They line up
	 * through this promise chain instead of the previous `blockConcurrencyWhile`,
	 * which serialized read-only pulls too, queued every round behind the slowest
	 * tail, and reset the whole object had one round ever run past 30 seconds.
	 */
	private writeLock: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly state: DurableObjectState,
		private readonly env: Env
	) {
		if (runtime.WebSocketRequestResponsePair)
			state.setWebSocketAutoResponse(
				new runtime.WebSocketRequestResponsePair(SOCKET_PING, SOCKET_PONG)
			);
	}

	fetch(request: Request): Promise<Response> {
		const path = new URL(request.url).pathname;
		if (path === '/socket') return Promise.resolve(this.socket(request));
		if (request.method !== 'POST') {
			return Promise.resolve(Response.json({ error: 'Not found' }, { status: 404 }));
		}
		return this.dispatch(path, request);
	}

	private async dispatch(path: string, request: Request): Promise<Response> {
		try {
			if (path === '/sync') return await this.syncRequest((await request.json()) as SyncInput);
			if (path === '/delete') {
				return await this.deleteRequest(
					String(((await request.json()) as { accountId?: unknown }).accountId)
				);
			}
		} catch (error) {
			return this.failure(path, error);
		}
		return Response.json({ error: 'Not found' }, { status: 404 });
	}

	private async syncRequest(input: SyncInput): Promise<Response> {
		if (input.uploads.length > 0 || input.deletions.length > 0)
			return this.exclusive('/sync', () => this.sync(input));
		// A read-only round touches nothing a later round would have to recompute,
		// so it runs without the lock and can overlap one, including from another device.
		try {
			return await this.sync(input);
		} catch (error) {
			return this.failure('/sync', error);
		}
	}

	private deleteRequest(accountId: string): Promise<Response> {
		return this.exclusive('/delete', () => this.deleteAccount(accountId));
	}

	/**
	 * Runs one mutating request behind the previous one. The chain never rejects:
	 * a failed round still releases the next waiter, so one bad write cannot
	 * strand every later one behind an unhandled rejection. A round that holds the
	 * lock past `MAX_WRITE_ROUND_MS` resets the object — the only way to cancel
	 * its storage calls — and it and every waiter fail, to be retried by clients.
	 */
	private async exclusive(path: string, work: () => Promise<Response>): Promise<Response> {
		const previous = this.writeLock;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.writeLock = previous.then(
			() => gate,
			() => gate
		);
		let watchdog: ReturnType<typeof setTimeout> | undefined;
		try {
			await previous;
			watchdog = setTimeout(() => {
				console.error(
					JSON.stringify({ level: 'error', event: 'account_coordinator_stuck', operation: path })
				);
				this.state.abort('A write round held the lock too long');
			}, MAX_WRITE_ROUND_MS);
			return await work();
		} catch (error) {
			return this.failure(path, error);
		} finally {
			clearTimeout(watchdog);
			release();
		}
	}

	/**
	 * The Worker only sees a failed status, so the cause is recorded here. The
	 * message names the storage error; nothing about the account or its data
	 * goes in.
	 */
	private failure(path: string, error: unknown): Response {
		console.error(
			JSON.stringify({
				level: 'error',
				event: 'account_coordinator_failed',
				operation: path,
				message: error instanceof Error ? error.message : 'Account coordinator failed'
			})
		);
		return Response.json({ error: 'Account coordinator failed' }, { status: 500 });
	}

	private socket(request: Request): Response {
		if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
			return Response.json({ error: 'Expected a WebSocket upgrade' }, { status: 426 });
		if (this.state.getWebSockets().length >= MAX_EVENT_SOCKETS) {
			return Response.json(
				{ error: 'Too many open change streams' },
				{ status: 429, headers: { 'retry-after': '5' } }
			);
		}
		const url = new URL(request.url);
		const expiresAt = Number(url.searchParams.get('expiresAt'));
		if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
			return Response.json({ error: 'Session expired' }, { status: 401 });
		const pair = new runtime.WebSocketPair();
		const [client, server] = [pair[0], pair[1]];
		this.state.acceptWebSocket(server);
		const attachment: SocketAttachment = {
			clientId: url.searchParams.get('clientId') ?? undefined,
			expiresAt
		};
		server.serializeAttachment(attachment);
		return new Response(null, { status: 101, webSocket: client } as ResponseInit);
	}

	/** Clients send only heartbeats, which the runtime answers; anything else is ignored. */
	webSocketMessage(): void {}

	webSocketClose(socket: WorkerSocket, code: number, reason: string): void {
		try {
			socket.close(code, reason);
		} catch {
			/* already closed */
		}
	}

	webSocketError(socket: WorkerSocket): void {
		try {
			socket.close(1011, 'Socket error');
		} catch {
			/* already closed */
		}
	}

	/** Tell every other open socket that the account changed, closing expired ones. */
	private announce(sequence: number, senderClientId?: string): void {
		const now = Date.now();
		for (const socket of this.state.getWebSockets()) {
			const attachment = socket.deserializeAttachment() as SocketAttachment | null;
			try {
				if (!attachment || attachment.expiresAt <= now) {
					socket.close(SOCKET_SESSION_EXPIRED, 'Session expired');
					continue;
				}
				// The writer already applied this change locally; waking it would
				// only make it sync again for nothing.
				if (senderClientId && attachment.clientId === senderClientId) continue;
				socket.send(JSON.stringify({ seq: sequence }));
			} catch {
				/* a socket that is closing needs no signal */
			}
		}
	}

	private async deleteAccount(accountId: string): Promise<Response> {
		const db = this.env.SCRAPSCACHE_DB;
		const keys = (
			await execute(db, {
				sql: `SELECT r2_key AS r2Key FROM envelopes WHERE account_id = ?
				UNION SELECT r2_key FROM deleted_envelopes WHERE account_id = ?
				UNION SELECT r2_key FROM envelope_history WHERE account_id = ?
				UNION SELECT r2_key FROM pending_envelopes WHERE account_id = ?`,
				args: [accountId, accountId, accountId, accountId]
			})
		).rows.map(({ r2Key }) => String(r2Key));
		// Objects first, in bulk: one subrequest per thousand, however much history the
		// account kept, and a deletion cut short leaves rows to retry against rather
		// than orphaned objects.
		await deleteObjects(this.env.SCRAPSCACHE_ENVELOPES, keys);
		const results = await batch(db, [
			{ sql: 'DELETE FROM accounts WHERE account_id = ?', args: [accountId] },
			{ sql: 'DELETE FROM pending_envelopes WHERE account_id = ?', args: [accountId] },
			{ sql: 'DELETE FROM reminder_push_devices WHERE account_id = ?', args: [accountId] },
			{ sql: 'DELETE FROM reminder_wakes WHERE account_id = ?', args: [accountId] },
			{ sql: 'DELETE FROM reminder_wake_revisions WHERE account_id = ?', args: [accountId] },
			{ sql: 'DELETE FROM reminder_wake_deliveries WHERE account_id = ?', args: [accountId] }
		]);
		for (const socket of this.state.getWebSockets()) {
			try {
				socket.close(SOCKET_SESSION_EXPIRED, 'Account deleted');
			} catch {
				/* already closed */
			}
		}
		return Response.json({ deleted: results[0]?.rowsAffected === 1 });
	}

	/** Builds the round's response with its per-phase timings attached. */
	private round(timings: SyncTimings, body: Record<string, unknown>): Response {
		return Response.json({ ...body, phaseTimings: timings.timings() });
	}

	/**
	 * One relay round. Everything the round decides with comes back in one D1
	 * batch — account, quota, download page, the live rows behind this call's
	 * uploads and deletions, and the older history those slots are about to
	 * replace — instead of eight sequential round trips. A mutating round runs
	 * under the write lock from its account read through the commit and the
	 * cleanup tail, so counters, history and usage never lose an update.
	 */
	private async sync(input: SyncInput): Promise<Response> {
		const db = this.env.SCRAPSCACHE_DB;
		const timings = createSyncTimings();
		try {
			const mutates = input.uploads.length > 0 || input.deletions.length > 0;
			const slots = [...new Set([...input.uploads, ...input.deletions].map(({ slot }) => slot))];
			const uploadIds = [...new Set(input.uploads.map(({ id }) => id))];
			const readQueries: SqlStatement[] = [
				{
					// The quota is joined here rather than fetched separately: a round
					// pays one D1 trip, not two, before it can decide anything.
					sql: `SELECT next_seq AS nextSeq, envelope_count AS envelopeCount,
					ciphertext_bytes AS ciphertextBytes, updated_at AS updatedAt,
					COALESCE(quota.max_bytes, ?) AS maxBytes,
					COALESCE(history.versions, 0) AS historyVersions,
					COALESCE(history.bytes, 0) AS historyBytes
					FROM accounts
					LEFT JOIN account_quotas AS quota USING (account_id)
					LEFT JOIN account_history_usage AS history USING (account_id)
					WHERE account_id = ?`,
					args: [input.maxAccountBytes, input.accountId]
				},
				{
					sql: `SELECT seq, id, slot, r2_key AS r2Key, ciphertext_bytes AS ciphertextBytes
					FROM envelopes WHERE account_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
					args: [input.accountId, input.cursor, Math.max(1, input.downloadLimit) + 1]
				}
			];
			if (mutates) {
				// The live rows this round replaces or reclaims, plus every id the
				// uploads reuse: ids are unique per account, so committing a second
				// row for one would fail the whole transaction on the unique index.
				const slotList = slots.map(() => '?').join(', ');
				const idList = uploadIds.map(() => '?').join(', ');
				const clause = uploadIds.length
					? `slot IN (${slotList}) OR id IN (${idList})`
					: `slot IN (${slotList})`;
				readQueries.push({
					sql: `SELECT seq, id, slot, r2_key AS r2Key, ciphertext_bytes AS ciphertextBytes
					FROM envelopes WHERE account_id = ? AND (${clause})`,
					args: [input.accountId, ...slots, ...uploadIds]
				});
				readQueries.push({
					sql: `SELECT COUNT(*) AS versions, COALESCE(SUM(ciphertext_bytes), 0) AS bytes
					FROM envelope_history AS history
					WHERE account_id = ? AND slot IN (${slots.map(() => '?').join(', ')}) AND ${OLDER_VERSION}`,
					args: [input.accountId, ...slots]
				});
			}
			timings.start('reads');
			const readResults = await batch(db, readQueries);
			timings.stop('reads');
			const accountRead = readResults[0];
			const pageRead = readResults[1];
			const currentRead = readResults[2];
			const olderBeforeRead = readResults[3];

			const account = accountRead?.rows[0] as
				| {
						nextSeq: number;
						envelopeCount: number;
						ciphertextBytes: number;
						updatedAt: number;
						historyVersions: number;
						historyBytes: number;
						maxBytes: number;
				  }
				| undefined;
			if (!account) return Response.json({ error: 'Sync account does not exist' }, { status: 404 });

			const maxBytes = Number(account.maxBytes) || input.maxAccountBytes;
			let envelopeCount = Number(account.envelopeCount);
			let ciphertextBytes = Number(account.ciphertextBytes);
			// Older versions share the quota with live records but never block them:
			// when the two together exceed it, the oldest versions give way.
			let historyVersions = Number(account.historyVersions);
			let historyBytes = Number(account.historyBytes);
			const storageBytes = (activeCount = envelopeCount, activeBytes = ciphertextBytes) =>
				activeBytes + activeCount * STORAGE_OVERHEAD_BYTES;
			const historyStorageBytes = () => historyBytes + historyVersions * STORAGE_OVERHEAD_BYTES;
			const usage = () => ({
				envelopeCount,
				ciphertextBytes,
				storageBytes: storageBytes() + historyStorageBytes(),
				maxBytes
			});
			const now = Math.max(Date.now(), Number(account.updatedAt) + 1);
			const touch = {
				sql: 'UPDATE accounts SET last_seen_at = ? WHERE account_id = ?',
				args: [now, input.accountId]
			};

			if (input.cursor > Number(account.nextSeq)) {
				await execute(db, touch);
				return this.round(timings, {
					cursor: 0,
					envelopes: [],
					conflicts: [],
					hasMore: false,
					reset: true,
					writesAccepted: false,
					usage: usage()
				});
			}

			const { page, hasMore } = fitDownloadPage(
				(pageRead?.rows ?? []) as EnvelopeRow[],
				Math.max(1, input.downloadLimit),
				MAX_DOWNLOAD_PAGE_BYTES,
				(row) => Number(row.ciphertextBytes)
			);
			if (page.length > 0) {
				await execute(db, touch);
				return this.round(timings, {
					cursor: page.at(-1)?.seq ?? input.cursor,
					envelopes: await hydrated(this.env, page, timings),
					conflicts: [],
					hasMore,
					reset: false,
					writesAccepted: !mutates,
					usage: usage()
				});
			}

			const currentBySlot = new Map<string, EnvelopeRow>();
			const uploadIdSet = new Set(uploadIds);
			const knownIds = new Set<string>();
			for (const row of (currentRead?.rows ?? []) as EnvelopeRow[]) {
				currentBySlot.set(row.slot, row);
				if (uploadIdSet.has(row.id)) knownIds.add(row.id);
			}
			// A conflicting relay state means this call did not see its own uploads,
			// so the client re-merges with the newer copy instead of covering it.
			const conflicts = input.uploads
				.map((upload) => ({ upload, current: currentBySlot.get(upload.slot) }))
				.filter(
					(value): value is { upload: Upload; current: EnvelopeRow } =>
						!!value.current &&
						value.current.id !== value.upload.id &&
						value.current.id !== (value.upload.expectedId ?? null)
				)
				.map(({ current }) => current);
			if (conflicts.length > 0) {
				await execute(db, touch);
				return this.round(timings, {
					cursor: Math.max(input.cursor, Number(account.nextSeq)),
					envelopes: [],
					conflicts: await hydrated(this.env, conflicts, timings),
					hasMore: false,
					reset: false,
					writesAccepted: false,
					usage: usage()
				});
			}

			// Uploads whose id the account already holds are dropped, and two uploads
			// sharing an id in one round deduplicate against the first.
			const acceptedUploads = input.uploads.filter(({ id }) => {
				if (knownIds.has(id)) return false;
				knownIds.add(id);
				return true;
			});
			// A retry of an upload that never committed finds the object its earlier
			// attempt reserved. It still writes under a fresh key: reusing the old one
			// would race the abandoned-upload sweep, which may delete that object after
			// this request has rewritten and committed it.
			const supersededKeys = acceptedUploads.length
				? (
						await execute(db, {
							sql: `SELECT r2_key AS r2Key FROM pending_envelopes
						 WHERE account_id = ? AND id IN (${acceptedUploads.map(() => '?').join(', ')})`,
							args: [input.accountId, ...acceptedUploads.map(({ id }) => id)]
						})
					).rows.map((row) => String(row.r2Key))
				: [];
			const prefix = await accountPrefix(input.accountId);
			const objectKeys = new Map(
				acceptedUploads.map(({ id }) => [id, `v1/${prefix}/${crypto.randomUUID()}`] as const)
			);

			const committed: SqlStatement[] = [];
			const deletedSlots: string[] = [];
			for (const deletion of input.deletions) {
				const removed = currentBySlot.get(deletion.slot);
				if (!removed || removed.id !== deletion.id) continue;
				deletedSlots.push(removed.slot);
				// The deleted copy is staged so its object is found again if this request
				// is cut short; right after the commit it goes, with every version of the
				// record.
				committed.push(
					{
						sql: `INSERT OR REPLACE INTO deleted_envelopes(
					account_id, slot, id, r2_key, ciphertext_bytes, deleted_at
				) VALUES (?, ?, ?, ?, ?, ?)`,
						args: [
							input.accountId,
							removed.slot,
							removed.id,
							removed.r2Key,
							removed.ciphertextBytes,
							now
						]
					},
					{
						sql: 'DELETE FROM envelopes WHERE account_id = ? AND slot = ? AND id = ?',
						args: [input.accountId, removed.slot, removed.id]
					}
				);
				envelopeCount -= 1;
				ciphertextBytes -= removed.ciphertextBytes;
				currentBySlot.delete(deletion.slot);
			}

			let sequence = Number(account.nextSeq);
			const continuedIds: string[] = [];
			for (const upload of acceptedUploads) {
				const prior = currentBySlot.get(upload.slot);
				const projectedCount = envelopeCount + (prior ? 0 : 1);
				const projectedBytes =
					ciphertextBytes + upload.ciphertext.length - (prior?.ciphertextBytes ?? 0);
				const projectedStorage = storageBytes(projectedCount, projectedBytes);
				// Nothing has been reserved or written yet, so a rejection costs no R2
				// operations and leaves nothing behind to clean up.
				if (projectedStorage > maxBytes && projectedStorage >= storageBytes()) {
					return Response.json({ error: 'quota' }, { status: 507 });
				}
				sequence += 1;
				if (prior && upload.continues) continuedIds.push(prior.id);
				if (prior)
					committed.push({
						sql: `INSERT INTO envelope_history(account_id, slot, id, r2_key, ciphertext_bytes, saved_at)
					SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (
						SELECT 1 FROM envelope_history WHERE account_id = ? AND id = ?
					)`,
						args: [
							input.accountId,
							prior.slot,
							prior.id,
							prior.r2Key,
							prior.ciphertextBytes,
							now,
							input.accountId,
							prior.id
						]
					});
				committed.push({
					sql: `INSERT INTO envelopes(account_id, slot, seq, id, r2_key, ciphertext_bytes)
				VALUES (?, ?, ?, ?, ?, ?)
					ON CONFLICT(account_id, slot) DO UPDATE SET
						seq = excluded.seq, id = excluded.id,
					r2_key = excluded.r2_key, ciphertext_bytes = excluded.ciphertext_bytes`,
					args: [
						input.accountId,
						upload.slot,
						sequence,
						upload.id,
						objectKeys.get(upload.id)!,
						upload.ciphertext.length
					]
				});
				committed.push({
					sql: `INSERT INTO envelope_history(account_id, slot, id, r2_key, ciphertext_bytes, saved_at)
					VALUES (?, ?, ?, ?, ?, ?)`,
					args: [
						input.accountId,
						upload.slot,
						upload.id,
						objectKeys.get(upload.id)!,
						upload.ciphertext.length,
						now
					]
				});
				committed.push({
					sql: 'DELETE FROM pending_envelopes WHERE account_id = ? AND id = ?',
					args: [input.accountId, upload.id]
				});
				// History and the live record can reference the same encrypted object.
				envelopeCount = projectedCount;
				ciphertextBytes = projectedBytes;
				currentBySlot.set(upload.slot, {
					seq: sequence,
					id: upload.id,
					slot: upload.slot,
					r2Key: objectKeys.get(upload.id)!,
					ciphertextBytes: upload.ciphertext.length
				});
			}
			committed.push({
				sql: `UPDATE accounts SET next_seq = ?, envelope_count = ?, ciphertext_bytes = ?,
				updated_at = ?, last_seen_at = ? WHERE account_id = ?`,
				args: [
					sequence,
					envelopeCount,
					ciphertextBytes,
					acceptedUploads.length > 0 || deletedSlots.length > 0 ? now : Number(account.updatedAt),
					now,
					input.accountId
				]
			});

			// The batch fits. Drop what earlier attempts left, reserve the new object
			// keys, write the bytes, and only then commit: a crash at any point from
			// here leaves a pending row the sweep can find, never an object nothing names.
			if (acceptedUploads.length > 0) {
				timings.start('r2_put');
				timings.count('r2_put', acceptedUploads.length);
				try {
					await Promise.all(
						supersededKeys.map((key) => this.env.SCRAPSCACHE_ENVELOPES.delete(key))
					);
					await batch(
						db,
						acceptedUploads.map(({ id }) => ({
							sql: `INSERT OR REPLACE INTO pending_envelopes(account_id, id, r2_key, created_at)
						VALUES (?, ?, ?, ?)`,
							args: [input.accountId, id, objectKeys.get(id)!, now]
						}))
					);
					await Promise.all(
						acceptedUploads.map((upload) =>
							this.env.SCRAPSCACHE_ENVELOPES.put(objectKeys.get(upload.id)!, upload.ciphertext)
						)
					);
				} finally {
					timings.stop('r2_put');
				}
			}

			timings.start('commit');
			try {
				await batch(db, committed);
			} finally {
				timings.stop('commit');
			}

			const mutated = acceptedUploads.length > 0 || deletedSlots.length > 0;
			if (mutated) {
				timings.start('tail');
				try {
					if (deletedSlots.length > 0)
						await purgeDeletedRecords(this.env, {
							accountId: input.accountId,
							slots: deletedSlots
						});
					await this.pruneHistory(
						input.accountId,
						touchedSlots(acceptedUploads, input.deletions),
						continuedIds
					);
					const olderBefore = olderBeforeRead?.rows[0] as
						{ versions: number; bytes: number } | undefined;
					const olderAfter = await olderVersions(
						db,
						input.accountId,
						touchedSlots(acceptedUploads, input.deletions)
					);
					const beforeVersions = Number(olderBefore?.versions ?? 0);
					const beforeBytes = Number(olderBefore?.bytes ?? 0);
					historyVersions += olderAfter.versions - beforeVersions;
					historyBytes += olderAfter.bytes - beforeBytes;
					if (storageBytes() + historyStorageBytes() > maxBytes && historyVersions > 0) {
						// Live records come first; the oldest counter-weight goes when there
						// is nothing else the account can spare.
						const oldest = (
							await execute(db, {
								sql: `SELECT history_id AS historyId, r2_key AS r2Key, ciphertext_bytes AS bytes
							FROM envelope_history AS history
							WHERE account_id = ? AND ${OLDER_VERSION}
							ORDER BY history_id ASC`,
								args: [input.accountId]
							})
						).rows as Array<{ historyId: number; r2Key: string; bytes: number }>;
						const evicted: typeof oldest = [];
						for (const row of oldest) {
							if (storageBytes() + historyStorageBytes() <= maxBytes) break;
							evicted.push(row);
							historyVersions -= 1;
							historyBytes -= Number(row.bytes);
						}
						await deleteHistoryRows(this.env, evicted);
					}
					if (
						historyVersions !== Number(account.historyVersions) ||
						historyBytes !== Number(account.historyBytes)
					)
						await execute(db, {
							sql: `INSERT INTO account_history_usage(account_id, versions, bytes) VALUES (?, ?, ?)
						ON CONFLICT(account_id) DO UPDATE SET versions = excluded.versions, bytes = excluded.bytes`,
							args: [input.accountId, historyVersions, historyBytes]
						});
				} finally {
					timings.stop('tail');
				}
				this.announce(sequence, input.senderClientId);
			}

			return this.round(timings, {
				cursor: Math.max(input.cursor, sequence),
				envelopes: [],
				conflicts: [],
				hasMore: false,
				reset: false,
				writesAccepted: acceptedUploads.length > 0 || deletedSlots.length > 0,
				usage: usage()
			});
		} catch (error) {
			return this.failure('/sync', error);
		}
	}

	/**
	 * Keep each touched record's newest versions, the live one included, and drop
	 * the versions that uploads continued. Objects go before rows, as in every
	 * cleanup.
	 */
	private async pruneHistory(
		accountId: string,
		slots: string[],
		continuedIds: string[]
	): Promise<void> {
		if (slots.length === 0) return;
		const continued = continuedIds.map(() => '?').join(', ');
		// The window counts only the versions that stay, as if the continued ones were gone.
		const expired = (
			await execute(this.env.SCRAPSCACHE_DB, {
				sql: `SELECT historyId, r2Key FROM (
				SELECT history_id AS historyId, r2_key AS r2Key,
					ROW_NUMBER() OVER (PARTITION BY slot ORDER BY history_id DESC) AS position
				FROM envelope_history
				WHERE account_id = ? AND slot IN (${slots.map(() => '?').join(', ')})${
					continuedIds.length ? ` AND id NOT IN (${continued})` : ''
				}
			) WHERE position > ?${
				continuedIds.length
					? ` UNION ALL SELECT history_id, r2_key FROM envelope_history
					WHERE account_id = ? AND id IN (${continued})`
					: ''
			}`,
				args: [
					accountId,
					...slots,
					...continuedIds,
					parseHistoryVersions(this.env.SCRAPSCACHE_HISTORY_VERSIONS),
					...(continuedIds.length ? [accountId, ...continuedIds] : [])
				]
			})
		).rows as Array<{ historyId: number; r2Key: string }>;
		await deleteHistoryRows(this.env, expired);
	}
}

function touchedSlots(uploads: { slot: string }[], deletions: { slot: string }[]): string[] {
	return [...new Set([...uploads.map(({ slot }) => slot), ...deletions.map(({ slot }) => slot)])];
}
