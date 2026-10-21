// @vitest-environment node
/**
 * What each kind of relay request costs in D1's billed units, measured against
 * Miniflare's D1, which reports `rows_read` and `rows_written` the way production
 * does. Opt-in, as it starts workerd: `MEASURE_D1=1 npx vitest run d1Cost`.
 * Production figures come from Cloudflare's own D1 query insights
 * (`wrangler d1 insights scrapscache`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { D1Database, DurableObjectState } from '@cloudflare/workers-types';
import { testR2 } from './testBindings';
import { SYNC_PROTOCOL_HEADER, SYNC_PROTOCOL_VERSION } from '#lib/model/protocol.js';

const harness = vi.hoisted(() => ({
	env: {} as Record<string, unknown>,
	pending: [] as Promise<unknown>[]
}));
vi.mock('cloudflare:workers', () => ({
	get env() {
		return harness.env;
	},
	waitUntil: (promise: Promise<unknown>) => harness.pending.push(promise)
}));
vi.mock('#lib/server/db.js', () => import('./db'));
vi.mock('#lib/server/syncStore.js', () => import('./syncStore'));
vi.mock('#lib/server/pairingSessions.js', () => import('./pairingSessions'));
vi.mock('#lib/server/metrics.js', () => import('./metrics'));
vi.mock('#lib/server/wakeTimer.js', () => ({ armWakeTimer: async () => undefined }));

const { Miniflare, convertV4MiniflareOptions } = await import('miniflare');
const { AccountCoordinator } = await import('../../../../cf/accountCoordinator');
const { SyncStore } = await import('./syncStore');
const { getSyncAuth } = await import('#lib/server/syncAuth.js');
const delta = await import('../../../routes/api/sync/v2/delta/+server');
const wakes = await import('../../../routes/api/sync/push/wakes/+server');
const pairStart = await import('../../../routes/api/sync/pair/start/+server');
const pairPoll = await import('../../../routes/api/sync/pair/poll/+server');

type Handler = (event: { request: Request; getClientAddress(): string }) => Promise<Response>;
type Cost = { rowsRead: number; rowsWritten: number; queries: number };
type Meta = { rows_read?: number; rows_written?: number };

/** Every statement's billed rows since the last request began. */
let spent: Cost = { rowsRead: 0, rowsWritten: 0, queries: 0 };
function count(meta: Meta) {
	spent.queries += 1;
	spent.rowsRead += meta.rows_read ?? 0;
	spent.rowsWritten += meta.rows_written ?? 0;
}

/** The D1 binding, with every statement it runs counted toward `spent`. */
function metered(db: D1Database): D1Database {
	type Statement = {
		sql: string;
		args: unknown[];
		bind(...args: unknown[]): Statement;
		run(): Promise<unknown>;
	};
	const statement = (sql: string, args: unknown[]): Statement => ({
		sql,
		args,
		bind: (...bound) => statement(sql, bound),
		async run() {
			const result = (await db
				.prepare(sql)
				.bind(...args)
				.run()) as { meta: Meta };
			count(result.meta);
			return result;
		}
	});
	return {
		prepare: (sql: string) => statement(sql, []),
		async batch(statements: Statement[]) {
			const results = await db.batch(
				statements.map(({ sql, args }) => db.prepare(sql).bind(...args))
			);
			for (const result of results) count(result.meta);
			return results;
		}
	} as unknown as D1Database;
}

const measuring = process.env.MEASURE_D1 === '1';
let mf: InstanceType<typeof Miniflare>;
let token = '';
const report: Record<string, Cost> = {};

/** Runs one request the way the server hook does, telemetry written after it included. */
async function measure(name: string, handler: unknown, request: Request): Promise<Response> {
	spent = { rowsRead: 0, rowsWritten: 0, queries: 0 };
	const response = await (handler as Handler)({ request, getClientAddress: () => '203.0.113.9' });
	await Promise.all(harness.pending.splice(0));
	expect(response.status, name).toBeLessThan(400);
	report[name] = spent;
	return response;
}

function post(path: string, body: unknown, method = 'POST'): Request {
	return new Request(`https://scrapscache.test${path}`, {
		method,
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${token}`,
			[SYNC_PROTOCOL_HEADER]: SYNC_PROTOCOL_VERSION
		},
		body: JSON.stringify(body)
	});
}

const slot = (n: number) => n.toString(16).padStart(64, '0');
const envelope = (n: number, expectedId: string | null = null, id = `record-${n}`) => ({
	id,
	slot: slot(n),
	expectedId,
	ciphertext: 'c'.repeat(800)
});

describe.runIf(measuring)('D1 cost per relay request', () => {
	beforeAll(async () => {
		mf = new Miniflare(
			convertV4MiniflareOptions({
				modules: true,
				script: 'export default { fetch() { return new Response(null); } }',
				d1Databases: ['DB']
			})
		);
		const db = (await mf.getD1Database('DB')) as unknown as D1Database;
		for (const file of readdirSync('cf/migrations').sort()) {
			const sql = readFileSync(`cf/migrations/${file}`, 'utf8')
				.split('\n')
				.filter((line) => !line.trim().startsWith('--'))
				.join('\n');
			// A statement ends at a semicolon closing its line, except inside a trigger body.
			const statements: string[] = [];
			let current = '';
			for (const line of sql.split('\n')) {
				current += `${line}\n`;
				const inTrigger = /\bBEGIN\s*$/m.test(current) && !/^END;\s*$/m.test(current);
				if (line.trim().endsWith(';') && !inTrigger) {
					statements.push(current.trim());
					current = '';
				}
			}
			if (current.trim()) statements.push(current.trim());
			await db.batch(statements.map((statement) => db.prepare(statement)));
		}
		// The app, its telemetry and the relay round all count against the same binding.
		const counted = metered(db);
		const r2 = testR2().bucket;
		const state = {
			abort: () => undefined,
			acceptWebSocket: () => undefined,
			getWebSockets: () => [],
			setWebSocketAutoResponse: () => undefined
		} as unknown as DurableObjectState;
		const coordinator = new AccountCoordinator(state, {
			SCRAPSCACHE_DB: counted,
			SCRAPSCACHE_ENVELOPES: r2
		});
		harness.env = {
			SCRAPSCACHE_DB: counted,
			SCRAPSCACHE_ENVELOPES: r2,
			ACCOUNT_COORDINATOR: {
				idFromName: (name: string) => name,
				get: () => ({
					fetch: (url: string, init: RequestInit) =>
						coordinator.fetch(new Request(url, init) as never)
				})
			}
		};
		await new SyncStore().createAccount('account-measured', 'credential');
		({ accessToken: token } = await getSyncAuth().createSyncSession('account-measured'));
		await db
			.prepare('UPDATE accounts SET last_seen_at = ? WHERE account_id = ?')
			.bind(Date.now(), 'account-measured')
			.run();
	});

	afterAll(async () => {
		await mf?.dispose();
		console.table(report);
	});

	it('measures each kind of request', async () => {
		const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
		await measure(
			'delta: upload 1 new record',
			delta.POST,
			post('/api/sync/v2/delta', {
				cursor: 0,
				envelopes: [envelope(1)]
			})
		);
		await measure(
			'delta: upload 16 new records',
			delta.POST,
			post('/api/sync/v2/delta', {
				cursor: 1,
				envelopes: Array.from({ length: 16 }, (_, index) => envelope(100 + index))
			})
		);
		await measure(
			'delta: replace 1 record (adds history)',
			delta.POST,
			post('/api/sync/v2/delta', {
				cursor: 17,
				envelopes: [envelope(1, 'record-1', 'record-1-v2')]
			})
		);
		await measure('delta: empty round', delta.POST, post('/api/sync/v2/delta', { cursor: 18 }));
		random.mockReturnValue(0);
		await measure(
			'delta: empty round, sampled for telemetry',
			delta.POST,
			post('/api/sync/v2/delta', { cursor: 18 })
		);
		random.mockReturnValue(0.5);
		await measure(
			'delta: download page of 12',
			delta.POST,
			post('/api/sync/v2/delta', { cursor: 0 })
		);
		await measure(
			'delta: delete 1 record',
			delta.POST,
			post('/api/sync/v2/delta', {
				cursor: 18,
				deleteSlots: [{ id: 'record-100', slot: slot(100) }]
			})
		);

		const list = Array.from({ length: 100 }, (_, index) => ({
			id: String.fromCharCode(65 + (index % 26)).repeat(42) + (index % 10),
			fireAt: Date.now() + (index + 1) * 60_000
		}));
		const unique = [...new Map(list.map((wake) => [wake.id, wake])).values()];
		await measure(
			'wakes: first publish of 100',
			wakes.PUT,
			post(
				'/api/sync/push/wakes',
				{
					revision: 1,
					wakes: unique
				},
				'PUT'
			)
		);
		await measure(
			'wakes: newer revision, same wakes',
			wakes.PUT,
			post(
				'/api/sync/push/wakes',
				{
					revision: 2,
					wakes: unique
				},
				'PUT'
			)
		);
		await measure(
			'wakes: one wake moved',
			wakes.PUT,
			post(
				'/api/sync/push/wakes',
				{
					revision: 3,
					wakes: [{ ...unique[0], fireAt: unique[0].fireAt + 1 }, ...unique.slice(1)]
				},
				'PUT'
			)
		);

		const started = (await (
			await measure(
				'pair: start',
				pairStart.POST,
				post('/api/sync/pair/start', {
					codeTag: 'a'.repeat(64),
					role: 'new',
					publicKey: 'k'.repeat(43)
				})
			)
		).json()) as { id: string };
		await measure(
			'pair: poll',
			pairPoll.POST,
			post('/api/sync/pair/poll', {
				sessionId: started.id
			})
		);
		random.mockRestore();

		expect(report['delta: empty round'].rowsWritten).toBe(2);
		expect(report['wakes: newer revision, same wakes'].rowsWritten).toBeLessThan(
			report['wakes: first publish of 100'].rowsWritten
		);
	});
});
