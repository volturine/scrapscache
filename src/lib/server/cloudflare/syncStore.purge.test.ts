import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client/node';
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
