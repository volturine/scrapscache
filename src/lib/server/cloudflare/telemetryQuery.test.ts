import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client/node';
import { applyMigrations, testD1 } from './testBindings';

const harness = vi.hoisted(() => ({ client: undefined as unknown, fail: false }));

vi.mock('$lib/server/db', () => {
	const ops = {
		execute: (statement: unknown) => {
			if (harness.fail) return Promise.reject(new Error('D1_ERROR: unavailable'));
			return (harness.client as Client).execute(statement as never);
		}
	};
	return { getDb: () => ({ relay: ops, ops, ready: Promise.resolve() }) };
});

import { HOUR_MS } from './metrics';
import { queryTelemetry } from './telemetryQuery';

let client: Client;
const hour = () => Math.floor(Date.now() / HOUR_MS);

async function count(hourIndex: number, key: string, value: number) {
	await client.execute({
		sql: 'INSERT INTO activity_hours(hour, key, value) VALUES (?, ?, ?)',
		args: [hourIndex, key, value]
	});
}

beforeEach(async () => {
	client = testD1().client;
	await applyMigrations(client);
	harness.client = client;
	harness.fail = false;
});

afterEach(() => vi.restoreAllMocks());

describe('reading activity back out of D1', () => {
	it('sums the hours inside the window into the activity an operator watches', async () => {
		const now = hour();
		for (const [key, value] of [
			['sync', 30],
			['uploads', 90],
			['deletes', 12],
			['storage_busy', 2],
			['wake_sent', 40],
			['wake_gone', 3],
			['wake_failed', 1],
			['http /api/sync/delta 500', 4],
			['http_ms /api/sync/delta 500', 80]
		] as const) {
			await count(now, key, value / 2);
			await count(now - 23, key, value / 2);
		}
		await count(now - 24, 'sync', 1000);

		const report = await queryTelemetry(24);

		expect(report).toMatchObject({ available: true, source: 'database', windowHours: 24 });
		expect(report.activity).toEqual({
			syncRequests: 30,
			syncUploadEnvelopes: 90,
			syncDeleteSlots: 12,
			sqliteBusy: 2,
			reminderWakesSent: 40,
			reminderWakesGone: 3,
			reminderWakesFailed: 1
		});
		expect(report.http).toEqual([
			{ route: '/api/sync/delta', status: '500', count: 4, durationMs: 80 }
		]);
	});

	it('needs no credentials beyond the database the Worker already has', async () => {
		const report = await queryTelemetry(24);
		expect(report.available).toBe(true);
		expect(report.activity?.syncRequests).toBe(0);
	});

	it('reads throttled callers from the rate-limit buckets, counting only recent refusals', async () => {
		const now = Date.now();
		for (const [key, allowed, seen] of [
			['refused-now', 0, now - 1_000],
			['allowed-now', 1, now - 1_000],
			['refused-long-ago', 0, now - 60 * 60_000]
		] as const) {
			await client.execute({
				sql: `INSERT INTO rate_buckets (bucket_key, tokens, updated_at, last_seen_at, last_allowed)
					VALUES (?, 0, ?, ?, ?)`,
				args: [key, seen, seen, allowed]
			});
		}

		expect((await queryTelemetry(24)).throttledNow).toBe(1);
	});

	it('drops hours older than the longest window', async () => {
		await count(hour() - 500, 'sync', 1);
		await count(hour() - 10, 'sync', 1);

		await queryTelemetry(1);

		const rows = await client.execute('SELECT hour FROM activity_hours');
		expect(rows.rows.map((row) => Number(row.hour))).toEqual([hour() - 10]);
	});

	it('clamps the window instead of trusting the caller', async () => {
		expect((await queryTelemetry(0)).windowHours).toBe(1);
		expect((await queryTelemetry(100_000)).windowHours).toBe(168);
	});

	it('degrades to unavailable rather than throwing when D1 fails', async () => {
		harness.fail = true;
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		const report = await queryTelemetry(24);

		expect(report).toMatchObject({ available: false, activity: null, throttledNow: null });
		expect(String(error.mock.calls[0]?.[0])).toContain('telemetry_query_failed');
	});
});
