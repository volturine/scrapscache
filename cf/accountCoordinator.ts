import type { D1Database, DurableObjectState, R2Bucket } from '@cloudflare/workers-types';
import { batch, execute, type SqlStatement } from '../src/lib/server/cloudflare/d1';
import { parseHistoryVersions } from '../src/lib/server/operatorConfig';
import {
	deleteHistoryRows,
	deleteObjects,
	OLDER_VERSION,
	olderVersions,
	purgeDeletedRecords
} from '../src/lib/server/cloudflare/history';

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
/** Concurrent change streams one account may hold open. Comfortably above a real
 * user's devices and tabs, and low enough that a session cannot grow this object's
 * memory or its timer count without bound. */
const MAX_EVENT_STREAMS = 16;
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

async function hydrated(env: Env, rows: EnvelopeRow[]) {
	return Promise.all(
		rows.map(async (row) => ({
			seq: row.seq,
			id: row.id,
			slot: row.slot,
			ciphertext: await ciphertext(env, row)
		}))
	);
}

export class AccountCoordinator {
	private readonly listeners = new Set<{ clientId?: string; send: (seq: number) => void }>();

	constructor(
		private readonly state: DurableObjectState,
		private readonly env: Env
	) {}

	fetch(request: Request): Promise<Response> {
		const path = new URL(request.url).pathname;
		if (path === '/events') return Promise.resolve(this.events(request));
		return this.state.blockConcurrencyWhile(async () => {
			if (request.method !== 'POST') {
				return Response.json({ error: 'Not found' }, { status: 404 });
			}
			try {
				if (path === '/sync') return await this.sync((await request.json()) as SyncInput);
				if (path === '/delete') {
					return await this.deleteAccount(
						String(((await request.json()) as { accountId?: unknown }).accountId)
					);
				}
			} catch (error) {
				// The Worker only sees a failed status, so the cause is recorded here. The message
				// names the storage error; nothing about the account or its data goes in.
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
			return Response.json({ error: 'Not found' }, { status: 404 });
		});
	}

	private events(request: Request): Response {
		if (this.listeners.size >= MAX_EVENT_STREAMS) {
			return Response.json(
				{ error: 'Too many open change streams' },
				{ status: 429, headers: { 'retry-after': '5' } }
			);
		}
		const encoder = new TextEncoder();
		const clientId = new URL(request.url).searchParams.get('clientId') ?? undefined;
		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();
		void writer.write(encoder.encode(': ok\n\n'));
		let ping: ReturnType<typeof setInterval> | undefined;
		const cleanup = () => {
			if (ping !== undefined) clearInterval(ping);
			this.listeners.delete(listener);
			void writer.close().catch(() => {});
		};
		// A write only fails once the peer is gone. Dropping the stream here matters
		// because the abort signal is the sole other exit, and a stream that outlives
		// its client would otherwise hold a slot against the cap for good.
		const listener = {
			clientId,
			send: (seq: number) => {
				void writer.write(encoder.encode(`data: ${JSON.stringify({ seq })}\n\n`)).catch(cleanup);
			}
		};
		this.listeners.add(listener);
		ping = setInterval(() => {
			void writer.write(encoder.encode(': ping\n\n')).catch(cleanup);
		}, 25_000);
		request.signal?.addEventListener('abort', cleanup);
		return new Response(readable, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive'
			}
		});
	}

	private async deleteAccount(accountId: string): Promise<Response> {
		const keys = (
			await execute(this.env.SCRAPSCACHE_DB, {
				sql: `SELECT r2_key AS r2Key FROM envelopes WHERE account_id = ?
					UNION SELECT r2_key FROM deleted_envelopes WHERE account_id = ?
					UNION SELECT r2_key FROM envelope_history WHERE account_id = ?
					UNION SELECT r2_key FROM pending_envelopes WHERE account_id = ?`,
				args: [accountId, accountId, accountId, accountId]
			})
		).rows.map(({ r2Key }) => String(r2Key));
		// Objects first, in bulk: one subrequest per thousand, however much history the account
		// kept, and a deletion cut short leaves rows to retry against rather than orphaned objects.
		await deleteObjects(this.env.SCRAPSCACHE_ENVELOPES, keys);
		const results = await batch(this.env.SCRAPSCACHE_DB, [
			{ sql: 'DELETE FROM accounts WHERE account_id = ?', args: [accountId] },
			{ sql: 'DELETE FROM pending_envelopes WHERE account_id = ?', args: [accountId] },
			{ sql: 'DELETE FROM reminder_push_devices WHERE account_id = ?', args: [accountId] },
			{ sql: 'DELETE FROM reminder_wakes WHERE account_id = ?', args: [accountId] },
			{ sql: 'DELETE FROM reminder_wake_revisions WHERE account_id = ?', args: [accountId] },
			{ sql: 'DELETE FROM reminder_wake_deliveries WHERE account_id = ?', args: [accountId] }
		]);
		return Response.json({ deleted: results[0]?.rowsAffected === 1 });
	}

	private async sync(input: SyncInput): Promise<Response> {
		const { SCRAPSCACHE_DB: db } = this.env;
		const account = (
			await execute(db, {
				sql: `SELECT next_seq AS nextSeq, envelope_count AS envelopeCount,
					ciphertext_bytes AS ciphertextBytes, updated_at AS updatedAt,
					COALESCE(history.versions, 0) AS historyVersions, COALESCE(history.bytes, 0) AS historyBytes
				 FROM accounts LEFT JOIN account_history_usage AS history USING (account_id)
				 WHERE account_id = ?`,
				args: [input.accountId]
			})
		).rows[0] as
			| {
					nextSeq: number;
					envelopeCount: number;
					ciphertextBytes: number;
					updatedAt: number;
					historyVersions: number;
					historyBytes: number;
			  }
			| undefined;
		if (!account) return Response.json({ error: 'Sync account does not exist' }, { status: 404 });

		const quota = (
			await execute(db, {
				sql: 'SELECT max_bytes AS maxBytes FROM account_quotas WHERE account_id = ?',
				args: [input.accountId]
			})
		).rows[0] as { maxBytes: number } | undefined;
		const maxBytes = quota?.maxBytes ?? input.maxAccountBytes;
		let envelopeCount = account.envelopeCount;
		let ciphertextBytes = account.ciphertextBytes;
		// Older versions share the quota with live records but never block them: when the two
		// together exceed it, the oldest versions give way.
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

		if (input.cursor > account.nextSeq) {
			await execute(db, {
				sql: 'UPDATE accounts SET last_seen_at = ? WHERE account_id = ?',
				args: [now, input.accountId]
			});
			return Response.json({
				cursor: 0,
				envelopes: [],
				conflicts: [],
				hasMore: false,
				reset: true,
				writesAccepted: false,
				usage: usage()
			});
		}

		const page = (
			await execute(db, {
				sql: `SELECT seq, id, slot, r2_key AS r2Key, ciphertext_bytes AS ciphertextBytes
				 FROM envelopes WHERE account_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
				args: [input.accountId, input.cursor, input.downloadLimit + 1]
			})
		).rows as EnvelopeRow[];
		const hasMore = page.length > input.downloadLimit;
		const remote = hasMore ? page.slice(0, input.downloadLimit) : page;
		if (remote.length > 0) {
			await execute(db, {
				sql: 'UPDATE accounts SET last_seen_at = ? WHERE account_id = ?',
				args: [now, input.accountId]
			});
			return Response.json({
				cursor: remote.at(-1)?.seq ?? input.cursor,
				envelopes: await hydrated(this.env, remote),
				conflicts: [],
				hasMore,
				reset: false,
				writesAccepted: input.uploads.length === 0 && input.deletions.length === 0,
				usage: usage()
			});
		}

		const slots = [...new Set([...input.uploads, ...input.deletions].map(({ slot }) => slot))];
		const currentRows = slots.length
			? ((
					await execute(db, {
						sql: `SELECT seq, id, slot, r2_key AS r2Key, ciphertext_bytes AS ciphertextBytes
						 FROM envelopes WHERE account_id = ? AND slot IN (${slots.map(() => '?').join(', ')})`,
						args: [input.accountId, ...slots]
					})
				).rows as EnvelopeRow[])
			: [];
		const currentBySlot = new Map(currentRows.map((row) => [row.slot, row]));
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
			await execute(db, {
				sql: 'UPDATE accounts SET last_seen_at = ? WHERE account_id = ?',
				args: [now, input.accountId]
			});
			return Response.json({
				cursor: Math.max(input.cursor, account.nextSeq),
				envelopes: [],
				conflicts: await hydrated(this.env, conflicts),
				hasMore: false,
				reset: false,
				writesAccepted: false,
				usage: usage()
			});
		}

		const knownIds = input.uploads.length
			? new Set(
					(
						await execute(db, {
							sql: `SELECT id FROM envelopes WHERE account_id = ? AND id IN (${input.uploads
								.map(() => '?')
								.join(', ')})`,
							args: [input.accountId, ...input.uploads.map(({ id }) => id)]
						})
					).rows.map(({ id }) => String(id))
				)
			: new Set<string>();
		const acceptedUploads = input.uploads.filter(({ id }) => {
			if (knownIds.has(id)) return false;
			knownIds.add(id);
			return true;
		});
		const prefix = await accountPrefix(input.accountId);
		// A retry of an upload that never committed finds the object its earlier
		// attempt reserved. It still writes under a fresh key: reusing the old one
		// would race the abandoned-upload sweep, which may delete that object after
		// this request has rewritten and committed it.
		const supersededObjects = acceptedUploads.length
			? (
					await execute(db, {
						sql: `SELECT r2_key AS r2Key FROM pending_envelopes
						 WHERE account_id = ? AND id IN (${acceptedUploads.map(() => '?').join(', ')})`,
						args: [input.accountId, ...acceptedUploads.map(({ id }) => id)]
					})
				).rows.map((row) => String(row.r2Key))
			: [];
		const objectKeys = new Map(
			acceptedUploads.map(({ id }) => [id, `v1/${prefix}/${crypto.randomUUID()}`] as const)
		);
		const statements: SqlStatement[] = [];
		const deletedSlots: string[] = [];
		for (const deletion of input.deletions) {
			const removed = currentBySlot.get(deletion.slot);
			if (!removed || removed.id !== deletion.id) continue;
			deletedSlots.push(removed.slot);
			// The deleted copy is staged so its object is found again if this request is cut
			// short; right after the commit it goes, with every version of the record.
			statements.push(
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

		let sequence = account.nextSeq;
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
				statements.push({
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
			statements.push({
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
			statements.push({
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
			statements.push({
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
		statements.push({
			sql: `UPDATE accounts SET next_seq = ?, envelope_count = ?, ciphertext_bytes = ?,
				updated_at = ?, last_seen_at = ? WHERE account_id = ?`,
			args: [
				sequence,
				envelopeCount,
				ciphertextBytes,
				acceptedUploads.length > 0 || deletedSlots.length > 0 ? now : account.updatedAt,
				now,
				input.accountId
			]
		});
		// The batch fits. Drop what earlier attempts left, reserve the new object
		// keys, write the bytes, and only then commit: a crash at any point from here
		// leaves a pending row the sweep can find, never an object nothing names.
		if (acceptedUploads.length > 0) {
			await Promise.all(supersededObjects.map((key) => this.env.SCRAPSCACHE_ENVELOPES.delete(key)));
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
		}

		const touched = [...new Set([...acceptedUploads, ...input.deletions].map(({ slot }) => slot))];
		const olderBefore = await olderVersions(db, input.accountId, touched);
		await batch(db, statements);

		const mutated = acceptedUploads.length > 0 || deletedSlots.length > 0;
		if (mutated) {
			if (deletedSlots.length > 0)
				await purgeDeletedRecords(this.env, { accountId: input.accountId, slots: deletedSlots });
			await this.pruneHistory(input.accountId, touched, continuedIds);
			const olderAfter = await olderVersions(db, input.accountId, touched);
			historyVersions += olderAfter.versions - olderBefore.versions;
			historyBytes += olderAfter.bytes - olderBefore.bytes;
			if (storageBytes() + historyStorageBytes() > maxBytes && historyVersions > 0) {
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
		}
		if (mutated) {
			for (const listener of this.listeners) {
				// The writer already applied this change locally; waking it would
				// only make it sync again for nothing.
				if (input.senderClientId && listener.clientId === input.senderClientId) continue;
				try {
					listener.send(sequence);
				} catch {}
			}
		}

		return Response.json({
			cursor: Math.max(input.cursor, sequence),
			envelopes: [],
			conflicts: [],
			hasMore: false,
			reset: false,
			writesAccepted: true,
			usage: usage()
		});
	}

	/**
	 * Keep each touched record's newest versions, the live one included, and drop the
	 * versions that uploads continued. Objects go before rows, as in every cleanup.
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
