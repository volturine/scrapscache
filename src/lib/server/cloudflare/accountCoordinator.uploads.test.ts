import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client/node';
import type { D1Database, DurableObjectState, R2Bucket } from '@cloudflare/workers-types';
import { applyMigrations, testD1, testR2 } from './testBindings';
import {
	AccountCoordinator,
	MAX_WRITE_ROUND_MS,
	SOCKET_PING,
	SOCKET_PONG,
	SOCKET_SESSION_EXPIRED
} from '../../../../cf/accountCoordinator';
import { MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST } from '$lib/syncLimits';

const ACCOUNT = 'account-abcdefghij';
const SLOT = 'a'.repeat(64);

let client: Client;
let objects: Map<string, string>;
let writes: () => number;
let coordinator: AccountCoordinator;
let bindings: { SCRAPSCACHE_DB: D1Database; SCRAPSCACHE_ENVELOPES: R2Bucket };

/** A hibernatable socket as the coordinator sees it. */
class FakeSocket {
	attachment: unknown = null;
	sent: string[] = [];
	closed: { code: number; reason: string } | null = null;
	serializeAttachment(value: unknown) {
		this.attachment = structuredClone(value);
	}
	deserializeAttachment() {
		return this.attachment;
	}
	send(message: string) {
		if (this.closed) throw new Error('Socket is closed');
		this.sent.push(message);
	}
	close(code: number, reason: string) {
		this.closed ??= { code, reason };
		sockets.splice(sockets.indexOf(this), 1);
	}
}
let sockets: FakeSocket[] = [];
const autoResponse = vi.fn();
const abort = vi.fn();
const state = {
	abort,
	acceptWebSocket: (socket: FakeSocket) => sockets.push(socket),
	getWebSockets: () => [...sockets],
	setWebSocketAutoResponse: autoResponse
} as unknown as DurableObjectState;

beforeEach(async () => {
	sockets = [];
	abort.mockClear();
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
	uploads: {
		id: string;
		slot: string;
		ciphertext: string;
		expectedId?: string;
		continues?: boolean;
	}[],
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

	it('replaces the version an upload continues and deletes its object', async () => {
		let cursor = 0;
		for (const [id, ciphertext, expectedId, continues] of [
			['before', 'aa', undefined, false],
			['draft', 'bb', 'before', false],
			['more', 'cc', 'draft', true],
			['final', 'dd', 'more', true]
		] as const) {
			const response = await sync(
				[{ id, slot: SLOT, ciphertext, expectedId, continues }],
				100_000_000,
				cursor
			);
			cursor = ((await response.json()) as { cursor: number }).cursor;
		}
		const history = await client.execute('SELECT id FROM envelope_history ORDER BY history_id');
		expect(history.rows.map((row) => row.id)).toEqual(['before', 'final']);
		expect([...objects.values()].sort()).toEqual(['aa', 'dd']);
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

describe('download pages', () => {
	it('stops a page at the byte budget and reports each round’s object reads', async () => {
		await sync([
			{ id: 'photo-1', slot: 'a'.repeat(64), ciphertext: 'p1' },
			{ id: 'photo-2', slot: 'b'.repeat(64), ciphertext: 'p2' },
			{ id: 'photo-3', slot: 'c'.repeat(64), ciphertext: 'p3' },
			{ id: 'note', slot: 'd'.repeat(64), ciphertext: 'n' }
		]);
		// Three 10 MB photos overflow one 24 MB page; the note rides with the last.
		await client.execute(
			"UPDATE envelopes SET ciphertext_bytes = 10000000 WHERE id LIKE 'photo-%'"
		);
		const pull = async (cursor: number) =>
			(await (
				await coordinator.fetch(
					new Request('https://coordinator/sync', {
						method: 'POST',
						body: JSON.stringify({
							accountId: ACCOUNT,
							cursor,
							uploads: [],
							deletions: [],
							downloadLimit: 50,
							maxAccountBytes: 100_000_000
						})
					}) as never
				)
			).json()) as {
				cursor: number;
				envelopes: { id: string; ciphertext: string }[];
				hasMore: boolean;
				phaseTimings: Record<string, number>;
			};

		const first = await pull(0);
		expect(first.envelopes.map(({ id }) => id)).toEqual(['photo-1', 'photo-2']);
		expect(first.hasMore).toBe(true);
		expect(first.phaseTimings['sync_calls phase:r2_get']).toBe(2);
		const second = await pull(first.cursor);
		expect(second.envelopes).toMatchObject([
			{ id: 'photo-3', ciphertext: 'p3' },
			{ id: 'note', ciphertext: 'n' }
		]);
		expect(second.hasMore).toBe(false);
	});
});

describe('round timings', () => {
	it('reports every phase an upload round goes through', async () => {
		// Each clock read moves 10 ms on, so every phase that starts takes time.
		let clock = 1_000_000;
		vi.spyOn(Date, 'now').mockImplementation(() => (clock += 10));

		const response = await sync([{ id: 'one', slot: SLOT, ciphertext: 'aaaa' }]);
		const { phaseTimings: timings } = (await response.json()) as {
			phaseTimings: Record<string, number>;
		};

		expect(
			Object.keys(timings)
				.filter((key) => key.startsWith('sync_ms'))
				.sort()
		).toEqual([
			'sync_ms phase:commit',
			'sync_ms phase:r2_put',
			'sync_ms phase:reads',
			'sync_ms phase:tail'
		]);
		expect(timings['sync_calls phase:r2_put']).toBe(1);
		vi.restoreAllMocks();
	});
});

describe('overlapping rounds', () => {
	type Round = { writesAccepted: boolean; envelopes: { id: string }[] };

	async function expectCountersMatchRows() {
		const account = (
			await client.execute(
				'SELECT next_seq AS nextSeq, envelope_count AS count, ciphertext_bytes AS bytes FROM accounts'
			)
		).rows[0];
		const rows = (
			await client.execute(
				'SELECT MAX(seq) AS seq, COUNT(*) AS count, SUM(ciphertext_bytes) AS bytes FROM envelopes'
			)
		).rows[0];
		expect(Number(account.nextSeq)).toBe(Number(rows.seq));
		expect(Number(account.count)).toBe(Number(rows.count));
		expect(Number(account.bytes)).toBe(Number(rows.bytes));
	}

	it('runs two uploads one after the other so neither loses the other’s counters', async () => {
		const results = await Promise.all([
			sync([{ id: 'one', slot: 'a'.repeat(64), ciphertext: 'aaaa' }]),
			sync([{ id: 'two', slot: 'b'.repeat(64), ciphertext: 'bbbbbbbb' }])
		]);
		const [first, second] = (await Promise.all(results.map((r) => r.json()))) as Round[];

		// The later round sees the earlier one's record and downloads it first.
		expect(first.writesAccepted).toBe(true);
		expect(second.writesAccepted).toBe(false);
		expect(second.envelopes.map(({ id }) => id)).toEqual(['one']);
		await expectCountersMatchRows();
	});

	it('lets the next upload run after one fails', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(bindings.SCRAPSCACHE_ENVELOPES, 'put').mockRejectedValueOnce(
			new Error('R2 unavailable')
		);

		const [failed, next] = await Promise.all([
			sync([{ id: 'one', slot: 'a'.repeat(64), ciphertext: 'aaaa' }]),
			sync([{ id: 'two', slot: 'b'.repeat(64), ciphertext: 'bbbb' }])
		]);

		expect(failed.status).toBe(500);
		expect(logged).toHaveBeenCalledTimes(1);
		expect(next.status).toBe(200);
		expect(((await next.json()) as Round).writesAccepted).toBe(true);
		await expectCountersMatchRows();
		vi.restoreAllMocks();
	});

	it('answers a download-only round while an upload is still writing', async () => {
		await sync([{ id: 'one', slot: 'a'.repeat(64), ciphertext: 'aaaa' }]);
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		const put = bindings.SCRAPSCACHE_ENVELOPES.put.bind(bindings.SCRAPSCACHE_ENVELOPES);
		const stalled = vi
			.spyOn(bindings.SCRAPSCACHE_ENVELOPES, 'put')
			.mockImplementation(async (...args) => {
				await held;
				return put(...args);
			});
		let uploaded = false;
		const upload = sync(
			[{ id: 'two', slot: 'b'.repeat(64), ciphertext: 'bbbb' }],
			100_000_000,
			1
		).then((response) => {
			uploaded = true;
			return response;
		});
		await vi.waitFor(() => expect(stalled).toHaveBeenCalled());

		const pull = (await (await sync([], 100_000_000, 0)).json()) as Round;
		expect(pull.envelopes.map(({ id }) => id)).toEqual(['one']);
		expect(uploaded).toBe(false);

		release();
		expect(((await (await upload).json()) as Round).writesAccepted).toBe(true);
		await expectCountersMatchRows();
		vi.restoreAllMocks();
	});
});

describe('a write round that never finishes', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('resets the object once the round has held the lock too long', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const stalled = vi
			.spyOn(bindings.SCRAPSCACHE_ENVELOPES, 'put')
			.mockImplementation(() => new Promise(() => {}));
		void sync([{ id: 'one', slot: SLOT, ciphertext: 'aaaa' }]);
		// Not vi.waitFor: it advances fake timers while it polls.
		while (stalled.mock.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));

		vi.advanceTimersByTime(MAX_WRITE_ROUND_MS - 1);
		expect(abort).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(abort).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(logged.mock.calls[0][0]))).toEqual({
			level: 'error',
			event: 'account_coordinator_stuck',
			operation: '/sync'
		});
		expect(String(logged.mock.calls[0][0])).not.toContain(ACCOUNT);
	});

	it('leaves the object alone after a round that finished', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		expect((await sync([{ id: 'one', slot: SLOT, ciphertext: 'aaaa' }])).status).toBe(200);

		vi.advanceTimersByTime(MAX_WRITE_ROUND_MS * 2);
		expect(abort).not.toHaveBeenCalled();
	});
});

describe('change sockets', () => {
	/** Node's Response refuses status 101, which the Workers runtime allows for upgrades. */
	class UpgradeResponse extends Response {
		private readonly upgrade?: number;
		readonly webSocket?: unknown;
		constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
			super(body, init?.status === 101 ? { ...init, status: 200 } : init);
			if (init?.status === 101) this.upgrade = 101;
			this.webSocket = init?.webSocket;
		}
		override get status() {
			return this.upgrade ?? super.status;
		}
	}

	beforeEach(() => {
		vi.stubGlobal('Response', UpgradeResponse);
		vi.stubGlobal(
			'WebSocketPair',
			class {
				0 = new FakeSocket();
				1 = new FakeSocket();
			}
		);
		vi.stubGlobal(
			'WebSocketRequestResponsePair',
			class {
				constructor(
					readonly request: string,
					readonly response: string
				) {}
			}
		);
		coordinator = new AccountCoordinator(state, bindings);
	});
	afterEach(() => vi.unstubAllGlobals());

	function connect(
		clientId = 'tab',
		expiresAt = Date.now() + 60_000,
		upgrade = 'websocket'
	): Promise<Response> {
		return coordinator.fetch(
			new Request(`https://coordinator/socket?clientId=${clientId}&expiresAt=${expiresAt}`, {
				headers: { upgrade }
			}) as never
		) as unknown as Promise<Response>;
	}

	function upload(senderClientId: string): Promise<Response> {
		return coordinator.fetch(
			new Request('https://coordinator/sync', {
				method: 'POST',
				body: JSON.stringify({
					accountId: ACCOUNT,
					cursor: 0,
					uploads: [{ id: `id-${senderClientId}`, slot: SLOT, ciphertext: 'bytes' }],
					deletions: [],
					downloadLimit: 12,
					maxAccountBytes: 100_000_000,
					senderClientId
				})
			}) as never
		) as unknown as Promise<Response>;
	}

	it('hibernates sockets and lets the runtime answer heartbeats', async () => {
		const response = await connect();
		expect(response.status).toBe(101);
		expect(sockets).toHaveLength(1);
		expect(autoResponse).toHaveBeenCalledWith(
			expect.objectContaining({ request: SOCKET_PING, response: SOCKET_PONG })
		);
	});

	it('refuses a request that is not an upgrade, or a session already expired', async () => {
		expect((await connect('tab', Date.now() + 60_000, 'h2c')).status).toBe(426);
		expect((await connect('tab', Date.now() - 1)).status).toBe(401);
		expect(sockets).toHaveLength(0);
	});

	it('refuses to grow this account beyond the socket cap, and frees a slot on close', async () => {
		for (let index = 0; index < 16; index++) expect((await connect()).status).toBe(101);
		const refused = await connect();
		expect(refused.status).toBe(429);
		expect(refused.headers.get('retry-after')).toBe('5');

		coordinator.webSocketClose(sockets[0] as never, 1000, 'bye');
		expect((await connect()).status).toBe(101);
	});

	it('signals other windows of an upload, not the uploader, and closes expired sessions', async () => {
		await connect('writer');
		await connect('reader');
		await connect('stale');
		const [writer, reader, stale] = sockets;
		(stale.attachment as { expiresAt: number }).expiresAt = Date.now() - 1;

		const cursor = ((await (await upload('writer')).json()) as { cursor: number }).cursor;
		expect(writer.sent).toEqual([]);
		expect(reader.sent).toEqual([JSON.stringify({ seq: cursor })]);
		expect(stale.closed?.code).toBe(SOCKET_SESSION_EXPIRED);
	});

	it('closes every socket when the account is deleted', async () => {
		await connect('one');
		await connect('two');
		const open = [...sockets];
		await coordinator.fetch(
			new Request('https://coordinator/delete', {
				method: 'POST',
				body: JSON.stringify({ accountId: ACCOUNT })
			}) as never
		);
		expect(open.map((socket) => socket.closed?.code)).toEqual([
			SOCKET_SESSION_EXPIRED,
			SOCKET_SESSION_EXPIRED
		]);
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
		const slots = Array.from({ length: MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST }, (_, index) =>
			index.toString(36).padStart(64, 'z')
		);
		let cursor = 0;
		const previous = new Map<string, string>();
		const round = async (version: number, continues = false) => {
			const response = await sync(
				slots.map((slot) => ({
					id: `${slot.slice(-1)}-${version}`,
					slot,
					ciphertext: 'x'.repeat(40),
					expectedId: previous.get(slot),
					continues
				})),
				100_000_000,
				cursor
			);
			cursor = ((await response.json()) as { cursor: number }).cursor;
			for (const slot of slots) previous.set(slot, `${slot.slice(-1)}-${version}`);
		};
		for (let version = 0; version < 14; version += 1) await round(version);
		expect(
			Number((await client.execute('SELECT COUNT(*) AS n FROM envelope_history')).rows[0].n)
		).toBe(slots.length * 14);

		// Every record saved once more: each save pushes its oldest version out of the window.
		const saving = countSubrequests();
		await round(14);
		expect(saving.count).toBeLessThanOrEqual(50);

		// Every save continuing its version drops that one too.
		const continuing = countSubrequests();
		await round(15, true);
		expect(continuing.count).toBeLessThanOrEqual(50);
		expect(
			Number((await client.execute('SELECT COUNT(*) AS n FROM envelope_history')).rows[0].n)
		).toBe(slots.length * 14);

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

describe('when storage fails', () => {
	it('records the cause without the account, and reports a failure', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(bindings.SCRAPSCACHE_DB, 'prepare').mockImplementation(() => {
			throw new Error('D1_ERROR: storage unavailable');
		});

		const response = await sync([{ id: 'one', slot: SLOT, ciphertext: 'aa' }]);

		expect(response.status).toBe(500);
		expect(logged).toHaveBeenCalledTimes(1);
		const entry = JSON.parse(String(logged.mock.calls[0][0]));
		expect(entry).toEqual({
			level: 'error',
			event: 'account_coordinator_failed',
			operation: '/sync',
			message: 'D1_ERROR: storage unavailable'
		});
		expect(String(logged.mock.calls[0][0])).not.toContain(ACCOUNT);
		vi.restoreAllMocks();
	});
});
