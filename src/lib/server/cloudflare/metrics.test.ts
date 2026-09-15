import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client/node';
import { applyMigrations, testD1 } from './testBindings';

const harness = vi.hoisted(() => ({
	platform: undefined as unknown,
	pending: [] as Promise<unknown>[],
	throwOutsideRequest: false
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => {
		if (harness.throwOutsideRequest) throw new Error('no request context');
		return { platform: harness.platform };
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
	recordSyncBatch
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
	harness.platform = {
		env: {
			SCRAPSCACHE_DB: {
				prepare: d1.db.prepare.bind(d1.db),
				batch: (statements: never[]) => {
					writes += 1;
					return batch(statements);
				}
			}
		},
		context: { waitUntil: (promise: Promise<unknown>) => harness.pending.push(promise) }
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
		recordSyncBatch(3, 2);
		recordSyncBatch(4, 0);
		recordReminderWake('failed');
		recordReminderWake('sent');
		recordSqliteError(new Error('SQLITE_BUSY: database is locked'));

		expect(await counters()).toEqual({
			deletes: 2,
			storage_busy: 1,
			sync: 2,
			uploads: 7,
			wake_failed: 1,
			wake_sent: 1
		});
		const hours = await client.execute('SELECT DISTINCT hour FROM activity_hours');
		expect(hours.rows.map((row) => Number(row.hour))).toEqual([Math.floor(Date.now() / HOUR_MS)]);
	});

	it('writes after the response, not in the way of it', async () => {
		recordSyncBatch(1, 0);
		expect(harness.pending).toHaveLength(1);
		expect(await counters()).toEqual({ sync: 1, uploads: 1 });
	});

	it('counts server errors by route bucket, and nothing for healthy or refused requests', async () => {
		recordHttpRequest('/api/sync/delta', 200, 5);
		recordHttpRequest('/api/sync/delta', 429, 5);
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
		harness.platform = { env: {}, context: { waitUntil: () => undefined } };
		expect(() => recordSyncBatch(1, 1)).not.toThrow();

		harness.throwOutsideRequest = true;
		expect(() => recordHttpRequest('/api/sync/delta', 500, 1)).not.toThrow();

		harness.throwOutsideRequest = false;
		harness.platform = {
			env: {
				SCRAPSCACHE_DB: {
					prepare: () => ({ bind: () => ({}) }),
					batch: () => Promise.reject(new Error('down'))
				}
			},
			context: { waitUntil: (promise: Promise<unknown>) => harness.pending.push(promise) }
		};
		recordSyncBatch(1, 1);
		await expect(Promise.all(harness.pending)).resolves.toBeDefined();
	});
});
