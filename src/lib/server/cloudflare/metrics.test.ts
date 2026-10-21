import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SYNC_DELTA_PATH } from '#lib/model/protocol.js';
import type { Client } from '@libsql/client/node';
import { applyMigrations, testD1 } from './testBindings';

const harness = vi.hoisted(() => ({
	env: {} as Record<string, unknown>,
	pending: [] as Promise<unknown>[],
	throwOutsideRequest: false
}));

vi.mock('cloudflare:workers', () => ({
	get env() {
		return harness.env;
	},
	waitUntil: (promise: Promise<unknown>) => {
		if (harness.throwOutsideRequest) throw new Error('no request context');
		harness.pending.push(promise);
	}
}));

import {
	HOUR_MS,
	metricsSnapshot,
	processActivity,
	recordHttpRequest,
	recordRateLimit,
	recordReminderWake,
	recordSqliteError,
	recordSyncBatch,
	SYNC_ROUND_SAMPLE
} from './metrics';

let client: Client;
let writes: number;

async function counters(): Promise<Record<string, number>> {
	await Promise.all(harness.pending);
	const rows = (await client.execute('SELECT key, value FROM activity_hours ORDER BY key')).rows;
	return Object.fromEntries(rows.map((row) => [String(row.key), Number(row.value)]));
}

beforeEach(async () => {
	const d1 = testD1();
	client = d1.client;
	await applyMigrations(client);
	writes = 0;
	const batch = d1.db.batch.bind(d1.db);
	harness.env = {
		SCRAPSCACHE_DB: {
			prepare: d1.db.prepare.bind(d1.db),
			batch: (statements: never[]) => {
				writes += 1;
				return batch(statements);
			}
		}
	};
	harness.pending = [];
	harness.throwOutsideRequest = false;
});

describe('Workers telemetry', () => {
	it('reports no process counters, because no isolate has the whole picture', () => {
		expect(processActivity()).toBeNull();
		expect(metricsSnapshot()).toBeNull();
	});

	it('adds sync batches, wakes and storage contention to this hour', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0);
		recordSyncBatch(3, 2);
		recordSyncBatch(4, 0);
		vi.restoreAllMocks();
		recordReminderWake('failed');
		recordReminderWake('sent');
		recordSqliteError(new Error('SQLITE_BUSY: database is locked'));

		expect(await counters()).toEqual({
			deletes: 2,
			storage_busy: 1,
			sync: 2 * SYNC_ROUND_SAMPLE,
			uploads: 7,
			wake_failed: 1,
			wake_sent: 1
		});
		const hours = await client.execute('SELECT DISTINCT hour FROM activity_hours');
		expect(hours.rows.map((row) => Number(row.hour))).toEqual([Math.floor(Date.now() / HOUR_MS)]);
	});

	it('counts one empty round in SYNC_ROUND_SAMPLE, weighted for the rest, and writes nothing for the others', async () => {
		const random = vi.spyOn(Math, 'random');
		for (let round = 0; round < SYNC_ROUND_SAMPLE; round += 1) {
			random.mockReturnValueOnce(round / SYNC_ROUND_SAMPLE);
			recordSyncBatch(0, 0);
		}
		random.mockRestore();

		expect(writes).toBe(1);
		expect(await counters()).toEqual({ sync: SYNC_ROUND_SAMPLE });
	});

	it('counts every upload and deletion even when the round itself is not sampled', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.99);
		recordSyncBatch(2, 1);
		vi.restoreAllMocks();

		expect(await counters()).toEqual({ deletes: 1, uploads: 2 });
	});

	it('writes after the response, not in the way of it', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0);
		recordSyncBatch(1, 0);
		vi.restoreAllMocks();
		expect(harness.pending).toHaveLength(1);
		expect(await counters()).toEqual({ sync: SYNC_ROUND_SAMPLE, uploads: 1 });
	});

	it('counts server errors by route bucket, and nothing for healthy or refused requests', async () => {
		recordHttpRequest(SYNC_DELTA_PATH, 200, 5);
		recordHttpRequest(SYNC_DELTA_PATH, 429, 5);
		recordRateLimit();
		recordHttpRequest('/api/sync/push/wakes', 503, 12.5);

		// A flood of refused requests must not buy a database write each.
		expect(writes).toBe(1);
		expect(await counters()).toEqual({
			'http /api/sync/push/* 503': 1,
			'http_ms /api/sync/push/* 503': 12.5
		});
	});

	it('ignores an error that is not storage contention', async () => {
		recordSqliteError(new Error('something else entirely'));
		expect(await counters()).toEqual({});
	});

	it('stays silent rather than failing a request when D1 is unavailable', async () => {
		const db = harness.env;
		harness.env = {};
		expect(() => recordSyncBatch(1, 1)).not.toThrow();

		harness.env = db;
		harness.throwOutsideRequest = true;
		expect(() => recordHttpRequest(SYNC_DELTA_PATH, 500, 1)).not.toThrow();

		harness.throwOutsideRequest = false;
		harness.env = {
			SCRAPSCACHE_DB: {
				prepare: () => ({ bind: () => ({}) }),
				batch: () => Promise.reject(new Error('down'))
			}
		};
		recordSyncBatch(1, 1);
		await expect(Promise.all(harness.pending)).resolves.toBeDefined();
	});
});
