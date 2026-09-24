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
let bindings: { SCRAPSCACHE_DB: D1Database; SCRAPSCACHE_ENVELOPES: R2Bucket };

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
	bindings = {
		SCRAPSCACHE_DB: d1.db as D1Database,
		SCRAPSCACHE_ENVELOPES: r2.bucket as R2Bucket
	};
	coordinator = new AccountCoordinator(state, bindings);
});

function sync(
	uploads: { id: string; slot: string; ciphertext: string; expectedId?: string }[],
	maxAccountBytes = 100_000_000,
	cursor = 0,
	deletions: { id: string; slot: string }[] = []
): Promise<Response> {
	return coordinator.fetch(
		new Request('https://coordinator/sync', {
			method: 'POST',
			body: JSON.stringify({
				accountId: ACCOUNT,
				cursor,
				uploads,
				deletions,
				downloadLimit: 12,
				maxAccountBytes
			})
		}) as never
	) as unknown as Promise<Response>;
}

describe('uploads that have to be retried', () => {
	it('retains initial and replaced R2 ciphertext for history and removes it with the account', async () => {
		const first = await sync([{ id: 'old', slot: SLOT, ciphertext: 'old-bytes' }]);
		const initial = await client.execute('SELECT id, r2_key AS r2Key FROM envelope_history');
		expect(initial.rows.map((row) => row.id)).toEqual(['old']);
		const firstCursor = ((await first.json()) as { cursor: number }).cursor;
		await sync(
			[{ id: 'new', slot: SLOT, ciphertext: 'new-bytes', expectedId: 'old' }],
			100_000_000,
			firstCursor
		);
		const history = await client.execute('SELECT id, r2_key AS r2Key FROM envelope_history');
		expect(history.rows.map((row) => row.id)).toEqual(['old', 'new']);
		const versions = await client.execute('SELECT saved_at AS savedAt FROM envelope_history');
		expect(Number(versions.rows[0].savedAt)).toBeGreaterThan(0);
		expect(objects.get(String(history.rows[0].r2Key))).toBe('old-bytes');
		expect(objects.get(String(history.rows[1].r2Key))).toBe('new-bytes');
		expect(objects.size).toBe(2);
		await coordinator.fetch(
			new Request('https://coordinator/delete', {
				method: 'POST',
				body: JSON.stringify({ accountId: ACCOUNT })
			}) as never
		);
		expect(objects.size).toBe(0);
		expect((await client.execute('SELECT history_id FROM envelope_history')).rows).toHaveLength(0);
	});

	it('keeps each record’s newest versions and deletes the objects that roll off', async () => {
		coordinator = new AccountCoordinator(state, { ...bindings, SCRAPSCACHE_HISTORY_VERSIONS: '2' });
		let cursor = 0;
		let previous: string | undefined;
		for (const [id, ciphertext] of [
			['one', 'aa'],
			['two', 'bb'],
			['three', 'cc']
		]) {
			const response = await sync(
				[{ id, slot: SLOT, ciphertext, expectedId: previous }],
				100_000_000,
				cursor
			);
			cursor = ((await response.json()) as { cursor: number }).cursor;
			previous = id;
		}
		await sync([{ id: 'other', slot: 'b'.repeat(64), ciphertext: 'dd' }], 100_000_000, cursor);
		const history = await client.execute('SELECT id FROM envelope_history ORDER BY history_id');
		expect(history.rows.map((row) => row.id)).toEqual(['two', 'three', 'other']);
		expect([...objects.values()].sort()).toEqual(['bb', 'cc', 'dd']);
	});

	it('counts older versions in quota and lets the oldest give way to live data', async () => {
		// Room for three stored versions of two bytes each, live or older.
		const quota = 3 * (512 + 2);
		let cursor = 0;
		let previous: string | undefined;
		let usage: { storageBytes: number } = { storageBytes: 0 };
		for (const [id, ciphertext] of [
			['one', 'aa'],
			['two', 'bb'],
			['three', 'cc']
		]) {
			const response = await sync(
				[{ id, slot: SLOT, ciphertext, expectedId: previous }],
				quota,
				cursor
			);
			({ cursor, usage } = (await response.json()) as {
				cursor: number;
				usage: { storageBytes: number };
			});
			previous = id;
		}
		// Live "three" plus older "two" and "one"; the live copy in history is not charged again.
		expect(usage.storageBytes).toBe(quota);

		const response = await sync(
			[{ id: 'other', slot: 'b'.repeat(64), ciphertext: 'dd' }],
			quota,
			cursor
		);
		const result = (await response.json()) as {
			writesAccepted: boolean;
			usage: { storageBytes: number };
		};
		expect(result.writesAccepted).toBe(true);
		expect(result.usage.storageBytes).toBe(quota);
		const history = await client.execute('SELECT id FROM envelope_history ORDER BY history_id');
		expect(history.rows.map((row) => row.id)).toEqual(['two', 'three', 'other']);
		expect([...objects.values()].sort()).toEqual(['bb', 'cc', 'dd']);
		expect(
			(await client.execute('SELECT versions, bytes FROM account_history_usage')).rows.map(
				(row) => [Number(row.versions), Number(row.bytes)]
			)
		).toEqual([[1, 2]]);
	});

	it('deletes a record with every version and object in the same request', async () => {
		let cursor = 0;
		let previous: string | undefined;
		for (const [id, ciphertext] of [
			['one', 'aa'],
			['two', 'bb']
		]) {
			const response = await sync(
				[{ id, slot: SLOT, ciphertext, expectedId: previous }],
				100_000_000,
				cursor
			);
			cursor = ((await response.json()) as { cursor: number }).cursor;
			previous = id;
		}
		expect(objects.size).toBe(2);

		const response = await sync([], 100_000_000, cursor, [{ id: 'two', slot: SLOT }]);
		expect(((await response.json()) as { writesAccepted: boolean }).writesAccepted).toBe(true);
		expect(objects.size).toBe(0);
		for (const table of ['envelopes', 'envelope_history', 'deleted_envelopes'])
			expect((await client.execute(`SELECT 1 FROM ${table}`)).rows).toEqual([]);
	});

	it('writes a retry under a fresh key and deletes the object the earlier attempt reserved', async () => {
		const reserved = 'v1/prefix/reserved-key';
		objects.set(reserved, 'first attempt');
		await client.execute({
			sql: 'INSERT INTO pending_envelopes(account_id,id,r2_key,created_at) VALUES (?,?,?,?)',
			args: [ACCOUNT, 'upload-1', reserved, 0]
		});

		const response = await sync([{ id: 'upload-1', slot: SLOT, ciphertext: 'second attempt' }]);
		expect(response.status).toBe(200);

		// A fresh key means a concurrent sweep of the old reservation can never
		// delete the committed bytes; the old object is not left orphaned either.
		const committed = await client.execute('SELECT id, r2_key AS r2Key FROM envelopes');
		expect(committed.rows).toHaveLength(1);
		const key = String(committed.rows[0].r2Key);
		expect(key).not.toBe(reserved);
		expect([...objects.keys()]).toEqual([key]);
		expect(objects.get(key)).toBe('second attempt');
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
		expect(
			(await client.execute('SELECT id FROM envelope_history')).rows.map((row) => row.id)
		).toEqual(['upload-1']);
	});

	it('records a force-style reupload as a new version', async () => {
		const first = await sync([{ id: 'initial', slot: SLOT, ciphertext: 'bytes' }]);
		const cursor = ((await first.json()) as { cursor: number }).cursor;
		await sync(
			[{ id: 'forced', slot: SLOT, ciphertext: 'bytes', expectedId: 'initial' }],
			100_000_000,
			cursor
		);
		const history = await client.execute('SELECT id FROM envelope_history ORDER BY history_id');
		expect(history.rows.map((row) => row.id)).toEqual(['initial', 'forced']);
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

describe('staying inside a free Workers invocation', () => {
	/** Count every D1 query and R2 call the coordinator makes, as Workers counts subrequests. */
	function countSubrequests(): { count: number } {
		const counter = { count: 0 };
		// The test D1 runs a batch statement by statement; D1 bills the batch once.
		let inBatch = false;
		const db = bindings.SCRAPSCACHE_DB as unknown as {
			prepare(sql: string): { run(): unknown; bind(...args: unknown[]): { run(): unknown } };
			batch(statements: unknown[]): unknown;
		};
		const prepare = db.prepare.bind(db);
		const counted = <T extends { run(): unknown }>(statement: T): T => {
			const run = statement.run.bind(statement);
			statement.run = () => {
				if (inBatch) return run();
				counter.count += 1;
				return run();
			};
			return statement;
		};
		db.prepare = (sql: string) => {
			const statement = counted(prepare(sql));
			const bind = statement.bind.bind(statement);
			statement.bind = (...args: unknown[]) => counted(bind(...args));
			return statement;
		};
		const runBatch = db.batch.bind(db);
		db.batch = async (statements: unknown[]) => {
			counter.count += 1;
			inBatch = true;
			try {
				return await runBatch(statements);
			} finally {
				inBatch = false;
			}
		};
		const bucket = bindings.SCRAPSCACHE_ENVELOPES as unknown as Record<string, unknown>;
		for (const method of ['get', 'put', 'delete', 'head', 'list']) {
			const original = bucket[method] as ((...args: unknown[]) => unknown) | undefined;
			if (!original) continue;
			bucket[method] = (...args: unknown[]) => {
				counter.count += 1;
				return original.apply(bucket, args);
			};
		}
		return counter;
	}

	it('saves and deletes a full batch of records with long histories in 50 subrequests or fewer', async () => {
		const slots = Array.from({ length: 8 }, (_, index) => String(index).repeat(64));
		let cursor = 0;
		const previous = new Map<string, string>();
		const round = async (version: number) => {
			const response = await sync(
				slots.map((slot) => ({
					id: `${slot.slice(0, 1)}-${version}`,
					slot,
					ciphertext: 'x'.repeat(40),
					expectedId: previous.get(slot)
				})),
				100_000_000,
				cursor
			);
			cursor = ((await response.json()) as { cursor: number }).cursor;
			for (const slot of slots) previous.set(slot, `${slot.slice(0, 1)}-${version}`);
		};
		for (let version = 0; version < 14; version += 1) await round(version);
		expect(
			Number((await client.execute('SELECT COUNT(*) AS n FROM envelope_history')).rows[0].n)
		).toBe(8 * 14);

		// Every record saved once more: each save pushes its oldest version out of the window.
		const saving = countSubrequests();
		await round(14);
		expect(saving.count).toBeLessThanOrEqual(50);

		// Every record deleted for good, with all of its versions.
		const deleting = countSubrequests();
		const response = await sync(
			[],
			100_000_000,
			cursor,
			slots.map((slot) => ({ id: previous.get(slot)!, slot }))
		);
		expect(((await response.json()) as { writesAccepted: boolean }).writesAccepted).toBe(true);
		expect(deleting.count).toBeLessThanOrEqual(50);
		expect(objects.size).toBe(0);
		expect((await client.execute('SELECT 1 FROM envelope_history')).rows).toEqual([]);
	});
});
