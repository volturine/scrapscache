import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client/node';
import type { D1Database } from '@cloudflare/workers-types';
import { applyMigrations, testD1, testR2 } from './testBindings';

const bindings = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('./env', () => ({ cloudflareBindings: () => bindings.value }));

import { DELETED_SLOT_GRACE_MS, PENDING_UPLOAD_GRACE_MS, SyncStore } from './syncStore';

const NOW = 1_800_000_000_000;
const ACCOUNT = 'account-abcdefghij';

let client: Client;
let objects: Map<string, string>;
let store: SyncStore;

beforeEach(async () => {
	const d1 = testD1();
	const r2 = testR2();
	client = d1.client;
	objects = r2.objects;
	await applyMigrations(client);
	bindings.value = {
		SCRAPSCACHE_DB: d1.db,
		SCRAPSCACHE_ENVELOPES: r2.bucket,
		SCRAPSCACHE_SYNC_MAX_ACCOUNT_BYTES: '100000000'
	};
	store = new SyncStore();
	await client.execute({
		sql: 'INSERT INTO accounts(account_id,credential_hash,updated_at,last_seen_at) VALUES (?,?,?,?)',
		args: [ACCOUNT, 'public-key', NOW, NOW]
	});
});

async function addPending(id: string, key: string, createdAt: number): Promise<void> {
	objects.set(key, 'ciphertext');
	await client.execute({
		sql: 'INSERT INTO pending_envelopes(account_id,id,r2_key,created_at) VALUES (?,?,?,?)',
		args: [ACCOUNT, id, key, createdAt]
	});
}

async function addEnvelope(id: string, slot: string, key: string): Promise<void> {
	objects.set(key, 'ciphertext');
	await client.execute({
		sql: 'INSERT INTO envelopes(account_id,slot,seq,id,r2_key,ciphertext_bytes) VALUES (?,?,?,?,?,?)',
		args: [ACCOUNT, slot, 1, id, key, 10]
	});
}

async function pendingIds(): Promise<string[]> {
	return (await client.execute('SELECT id FROM pending_envelopes ORDER BY id')).rows.map((row) =>
		String(row.id)
	);
}

describe('reclaiming storage nothing points at', () => {
	it('deletes an upload that reserved an object and never committed', async () => {
		await addPending('abandoned', 'v1/prefix/abandoned', NOW - PENDING_UPLOAD_GRACE_MS - 1);

		expect(await store.purgeExpiredDeletedEnvelopes(NOW)).toBe(1);
		expect(objects.has('v1/prefix/abandoned')).toBe(false);
		expect(await pendingIds()).toEqual([]);
	});

	it('leaves an upload that is still in flight alone', async () => {
		await addPending('in-flight', 'v1/prefix/in-flight', NOW - 1_000);

		expect(await store.purgeExpiredDeletedEnvelopes(NOW)).toBe(0);
		expect(objects.has('v1/prefix/in-flight')).toBe(true);
		expect(await pendingIds()).toEqual(['in-flight']);
	});

	it('clears a stale row for a committed upload without touching its live object', async () => {
		const key = 'v1/prefix/committed';
		await addEnvelope('committed', 'a'.repeat(64), key);
		await addPending('committed', key, NOW - PENDING_UPLOAD_GRACE_MS - 1);

		expect(await store.purgeExpiredDeletedEnvelopes(NOW)).toBe(0);
		expect(objects.has(key)).toBe(true);
		expect(await pendingIds()).toEqual([]);
	});

	it('spares an upload a retry re-reserved after the sweep read it', async () => {
		await addPending('retried', 'v1/prefix/old', NOW - PENDING_UPLOAD_GRACE_MS - 1);
		const d1 = (bindings.value as { SCRAPSCACHE_DB: D1Database }).SCRAPSCACHE_DB;
		const runBatch = d1.batch.bind(d1);
		// The retry lands between the sweep's read and its delete: it drops the old
		// object and reserves a fresh key for the same upload.
		d1.batch = (async (statements: Parameters<D1Database['batch']>[0]) => {
			objects.delete('v1/prefix/old');
			objects.set('v1/prefix/new', 'retry');
			await client.execute({
				sql: 'UPDATE pending_envelopes SET r2_key=?, created_at=? WHERE id=?',
				args: ['v1/prefix/new', NOW, 'retried']
			});
			return runBatch(statements);
		}) as D1Database['batch'];

		expect(await store.purgeExpiredDeletedEnvelopes(NOW)).toBe(0);
		expect(objects.get('v1/prefix/new')).toBe('retry');
		expect(await pendingIds()).toEqual(['retried']);
	});

	it('still purges deleted slots past their grace window, counting both kinds', async () => {
		objects.set('v1/prefix/deleted', 'ciphertext');
		await client.execute({
			sql: `INSERT INTO deleted_envelopes(account_id,slot,id,r2_key,ciphertext_bytes,deleted_at)
				VALUES (?,?,?,?,?,?)`,
			args: [ACCOUNT, 'b'.repeat(64), 'deleted', 'v1/prefix/deleted', 10, NOW - 15 * 86_400_000]
		});
		await addPending('abandoned', 'v1/prefix/abandoned', NOW - PENDING_UPLOAD_GRACE_MS - 1);

		expect(await store.purgeExpiredDeletedEnvelopes(NOW)).toBe(2);
		expect(objects.size).toBe(0);
	});

	it('keeps a recently deleted slot so devices can still observe the deletion', async () => {
		objects.set('v1/prefix/recent', 'ciphertext');
		await client.execute({
			sql: `INSERT INTO deleted_envelopes(account_id,slot,id,r2_key,ciphertext_bytes,deleted_at)
				VALUES (?,?,?,?,?,?)`,
			args: [ACCOUNT, 'c'.repeat(64), 'recent', 'v1/prefix/recent', 10, NOW - 86_400_000]
		});

		expect(await store.purgeExpiredDeletedEnvelopes(NOW)).toBe(0);
		expect(objects.has('v1/prefix/recent')).toBe(true);
	});
});

describe('history of records deleted for good', () => {
	const DELETED_AT = NOW - DELETED_SLOT_GRACE_MS - 1;

	async function addHistory(id: string, slot: string, key: string): Promise<void> {
		objects.set(key, 'ciphertext');
		await client.execute({
			sql: 'INSERT INTO envelope_history(account_id,slot,id,r2_key,ciphertext_bytes,saved_at) VALUES (?,?,?,?,?,?)',
			args: [ACCOUNT, slot, id, key, 10, 1]
		});
	}

	async function addDeleted(slot: string, id: string, key: string, deletedAt: number) {
		objects.set(key, 'ciphertext');
		await client.execute({
			sql: 'INSERT INTO deleted_envelopes(account_id,slot,id,r2_key,ciphertext_bytes,deleted_at) VALUES (?,?,?,?,?,?)',
			args: [ACCOUNT, slot, id, key, 10, deletedAt]
		});
	}

	async function historyIds(): Promise<string[]> {
		return (await client.execute('SELECT id FROM envelope_history ORDER BY id')).rows.map((row) =>
			String(row.id)
		);
	}

	it('removes a deleted record’s versions and objects once its grace ends', async () => {
		const gone = 'a'.repeat(64);
		await addHistory('gone-1', gone, 'v1/prefix/gone-1');
		await addHistory('gone-2', gone, 'v1/prefix/gone-2');
		await addDeleted(gone, 'gone-2', 'v1/prefix/gone-2', DELETED_AT);
		// Deleted, but still inside its grace.
		const recent = 'b'.repeat(64);
		await addHistory('recent', recent, 'v1/prefix/recent');
		await addDeleted(recent, 'recent', 'v1/prefix/recent', NOW);
		// Deleted, then written again: its history belongs to the live record now.
		const back = 'c'.repeat(64);
		await addHistory('back-old', back, 'v1/prefix/back-old');
		await addDeleted(back, 'back-old', 'v1/prefix/back-old', DELETED_AT);
		await addEnvelope('back-new', back, 'v1/prefix/back-new');

		await store.purgeExpiredDeletedEnvelopes(NOW);

		expect(await historyIds()).toEqual(['back-old', 'recent']);
		expect([...objects.keys()].sort()).toEqual([
			'v1/prefix/back-new',
			'v1/prefix/back-old',
			'v1/prefix/recent'
		]);
	});

	it('never leaves an object that no row points at when a sweep is cut short', async () => {
		const gone = 'a'.repeat(64);
		await addHistory('gone-1', gone, 'v1/prefix/gone-1');
		await addDeleted(gone, 'gone-2', 'v1/prefix/gone-2', DELETED_AT);
		const bucket = (
			bindings.value as {
				SCRAPSCACHE_ENVELOPES: { delete(keys: string | string[]): Promise<void> };
			}
		).SCRAPSCACHE_ENVELOPES;
		// The sweep dies mid-way, as a Worker that runs out of subrequests would.
		const spy = vi.spyOn(bucket, 'delete').mockRejectedValueOnce(new Error('subrequest limit'));
		await expect(store.purgeExpiredDeletedEnvelopes(NOW)).rejects.toThrow('subrequest limit');
		spy.mockRestore();
		const named = new Set(
			[
				...(await client.execute('SELECT r2_key AS key FROM envelope_history')).rows,
				...(await client.execute('SELECT r2_key AS key FROM deleted_envelopes')).rows
			].map((row) => String(row.key))
		);
		for (const key of objects.keys()) expect(named.has(key)).toBe(true);

		await store.purgeExpiredDeletedEnvelopes(NOW);
		expect(await historyIds()).toEqual([]);
		expect(objects.size).toBe(0);
	});

	it('recounts history usage from the rows, correcting a count a cut-short request left off', async () => {
		const slot = 'd'.repeat(64);
		await addEnvelope('live', slot, 'v1/prefix/live');
		await addHistory('live', slot, 'v1/prefix/live');
		await addHistory('older', slot, 'v1/prefix/older');
		await client.execute({
			sql: 'INSERT INTO account_history_usage(account_id, versions, bytes) VALUES (?, ?, ?)',
			args: [ACCOUNT, 7, 7_000]
		});

		await store.purgeExpiredDeletedEnvelopes(NOW);

		const rows = (await client.execute('SELECT versions, bytes FROM account_history_usage')).rows;
		// Only the older version counts; the live copy is already in the account's usage.
		expect(rows.map((row) => [Number(row.versions), Number(row.bytes)])).toEqual([[1, 10]]);
	});
});
