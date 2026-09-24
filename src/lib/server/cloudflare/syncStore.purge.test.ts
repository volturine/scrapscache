import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client/node';
import type { D1Database } from '@cloudflare/workers-types';
import { applyMigrations, testD1, testR2 } from './testBindings';

const bindings = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('./env', () => ({ cloudflareBindings: () => bindings.value }));

import { PENDING_UPLOAD_GRACE_MS, SyncStore } from './syncStore';

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

describe('expiring encrypted note history', () => {
	const DAY = 86_400_000;

	async function addHistory(id: string, slot: string, key: string, savedAt: number): Promise<void> {
		objects.set(key, 'ciphertext');
		await client.execute({
			sql: 'INSERT INTO envelope_history(account_id,slot,id,r2_key,ciphertext_bytes,saved_at) VALUES (?,?,?,?,?,?)',
			args: [ACCOUNT, slot, id, key, 10, savedAt]
		});
	}

	async function historyIds(): Promise<string[]> {
		return (await client.execute('SELECT id FROM envelope_history ORDER BY id')).rows.map((row) =>
			String(row.id)
		);
	}

	it('deletes expired versions and their objects, keeping what the live note still uses', async () => {
		await addHistory('old', 'a'.repeat(64), 'v1/prefix/old', NOW - 31 * DAY);
		await addEnvelope('live', 'b'.repeat(64), 'v1/prefix/live');
		await client.execute({
			sql: 'INSERT INTO envelope_history(account_id,slot,id,r2_key,ciphertext_bytes,saved_at) VALUES (?,?,?,?,?,?)',
			args: [ACCOUNT, 'b'.repeat(64), 'live', 'v1/prefix/live', 10, NOW - 31 * DAY]
		});
		await addHistory('recent', 'c'.repeat(64), 'v1/prefix/recent', NOW - DAY);

		expect(await store.purgeExpiredHistory(NOW)).toBe(2);
		expect(await historyIds()).toEqual(['recent']);
		expect(objects.has('v1/prefix/old')).toBe(false);
		expect(objects.has('v1/prefix/live')).toBe(true);
		expect(objects.has('v1/prefix/recent')).toBe(true);
	});

	it('never leaves an object that no row points at when a sweep is cut short', async () => {
		await addHistory('old', 'a'.repeat(64), 'v1/prefix/old', NOW - 31 * DAY);
		const bucket = (
			bindings.value as { SCRAPSCACHE_ENVELOPES: { delete(key: string): Promise<void> } }
		).SCRAPSCACHE_ENVELOPES;
		// The sweep dies mid-way, as a Worker that runs out of subrequests would.
		const spy = vi.spyOn(bucket, 'delete').mockRejectedValueOnce(new Error('subrequest limit'));
		await expect(store.purgeExpiredHistory(NOW)).rejects.toThrow('subrequest limit');
		spy.mockRestore();
		const keys = (await client.execute('SELECT r2_key AS key FROM envelope_history')).rows.map(
			(row) => String(row.key)
		);
		for (const key of objects.keys()) expect(keys).toContain(key);

		expect(await store.purgeExpiredHistory(NOW)).toBe(1);
		expect(await historyIds()).toEqual([]);
		expect(objects.size).toBe(0);
	});
});
