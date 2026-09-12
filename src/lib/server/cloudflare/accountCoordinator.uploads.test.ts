import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client/node';
import type { D1Database, DurableObjectState, R2Bucket } from '@cloudflare/workers-types';
import { applyMigrations, testD1, testR2 } from './testBindings';
import { AccountCoordinator } from '../../../../cf/accountCoordinator';

const ACCOUNT = 'account-abcdefghij';
const SLOT = 'a'.repeat(64);

let client: Client;
let objects: Map<string, string>;
let writes: () => number;
let coordinator: AccountCoordinator;

const state = {
	blockConcurrencyWhile: <T>(body: () => Promise<T>) => body()
} as unknown as DurableObjectState;

beforeEach(async () => {
	const d1 = testD1();
	const r2 = testR2();
	client = d1.client;
	objects = r2.objects;
	writes = r2.writes;
	await applyMigrations(client);
	await client.execute({
		sql: 'INSERT INTO accounts(account_id,credential_hash,updated_at,last_seen_at) VALUES (?,?,?,?)',
		args: [ACCOUNT, 'public-key', 0, 0]
	});
	coordinator = new AccountCoordinator(state, {
		SCRAPSCACHE_DB: d1.db as D1Database,
		SCRAPSCACHE_ENVELOPES: r2.bucket as R2Bucket
	});
});

function sync(
	uploads: { id: string; slot: string; ciphertext: string }[],
	maxAccountBytes = 100_000_000
): Promise<Response> {
	return coordinator.fetch(
		new Request('https://coordinator/sync', {
			method: 'POST',
			body: JSON.stringify({
				accountId: ACCOUNT,
				cursor: 0,
				uploads,
				deletions: [],
				downloadLimit: 12,
				maxAccountBytes
			})
		}) as never
	) as unknown as Promise<Response>;
}

describe('uploads that have to be retried', () => {
	it('reuses the object key a previous attempt reserved', async () => {
		const reserved = 'v1/prefix/reserved-key';
		objects.set(reserved, 'first attempt');
		await client.execute({
			sql: 'INSERT INTO pending_envelopes(account_id,id,r2_key,created_at) VALUES (?,?,?,?)',
			args: [ACCOUNT, 'upload-1', reserved, 0]
		});

		const response = await sync([{ id: 'upload-1', slot: SLOT, ciphertext: 'second attempt' }]);
		expect(response.status).toBe(200);

		// One object, at the reserved key, holding the committed bytes. A freshly
		// minted key would leave the first object with nothing referencing it.
		expect([...objects.keys()]).toEqual([reserved]);
		expect(objects.get(reserved)).toBe('second attempt');

		const committed = await client.execute('SELECT id, r2_key AS r2Key FROM envelopes');
		expect(committed.rows).toHaveLength(1);
		expect(String(committed.rows[0].r2Key)).toBe(reserved);
	});

	it('clears the pending row once the upload commits', async () => {
		await sync([{ id: 'upload-1', slot: SLOT, ciphertext: 'bytes' }]);

		const pending = await client.execute('SELECT id FROM pending_envelopes');
		expect(pending.rows).toEqual([]);
		expect(objects.size).toBe(1);
	});

	it('leaves exactly one object behind when the same upload is sent twice', async () => {
		await sync([{ id: 'upload-1', slot: SLOT, ciphertext: 'bytes' }]);
		await sync([{ id: 'upload-1', slot: SLOT, ciphertext: 'bytes' }]);

		expect(objects.size).toBe(1);
	});
});

describe('uploads that do not fit', () => {
	it('rejects over quota without writing or reserving anything', async () => {
		// One envelope plus its 512-byte accounting overhead already exceeds this.
		const response = await sync([{ id: 'too-big', slot: SLOT, ciphertext: 'x'.repeat(200) }], 600);

		expect(response.status).toBe(507);
		expect(writes()).toBe(0);
		expect(objects.size).toBe(0);
		expect((await client.execute('SELECT id FROM pending_envelopes')).rows).toEqual([]);
		expect((await client.execute('SELECT id FROM envelopes')).rows).toEqual([]);
	});

	it('commits a batch that fits', async () => {
		const response = await sync([{ id: 'fits', slot: SLOT, ciphertext: 'x'.repeat(200) }], 100_000);

		expect(response.status).toBe(200);
		expect(objects.size).toBe(1);
		expect((await client.execute('SELECT id FROM envelopes')).rows).toHaveLength(1);
	});

	it('rejects the whole batch when only its last upload overflows', async () => {
		const response = await sync(
			[
				{ id: 'first', slot: 'd'.repeat(64), ciphertext: 'x'.repeat(200) },
				{ id: 'second', slot: 'e'.repeat(64), ciphertext: 'x'.repeat(200) }
			],
			1_000
		);

		expect(response.status).toBe(507);
		expect(writes()).toBe(0);
		expect(objects.size).toBe(0);
	});
});

describe('change streams', () => {
	const open: AbortController[] = [];

	afterEach(() => {
		for (const controller of open) controller.abort();
		open.length = 0;
	});

	function stream(): Promise<Response> {
		const controller = new AbortController();
		open.push(controller);
		return coordinator.fetch(
			new Request('https://coordinator/events?clientId=tab', {
				signal: controller.signal
			}) as never
		) as unknown as Promise<Response>;
	}

	it('opens a stream for a normal client', async () => {
		const response = await stream();
		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toBe('text/event-stream');
	});

	it('refuses to grow this account beyond the stream cap', async () => {
		for (let index = 0; index < 16; index++) expect((await stream()).status).toBe(200);

		const refused = await stream();
		expect(refused.status).toBe(429);
		expect(refused.headers.get('retry-after')).toBe('5');
	});

	it('frees the slot again when a client disconnects', async () => {
		for (let index = 0; index < 16; index++) await stream();
		expect((await stream()).status).toBe(429);

		open.shift()!.abort();
		await Promise.resolve();

		expect((await stream()).status).toBe(200);
	});
});
