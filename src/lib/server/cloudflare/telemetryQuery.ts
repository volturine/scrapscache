import { getDb } from '$lib/server/db';
import { countThrottledCallers } from '$lib/server/rateLimit';
import { HOUR_MS } from './metrics';

export type { ActivityCounts, TelemetryReport } from '$lib/server/telemetryQuery';
import type { ActivityCounts, TelemetryReport } from '$lib/server/telemetryQuery';

/** Longest window the dashboard can ask for, and how long counters are kept. */
const MAX_HOURS = 168;

/**
 * Sums the hourly counters the Worker wrote to D1. The window is whole hours,
 * including the current partial one, so "last 24h" can reach back up to 25.
 * Old hours are dropped here rather than by a schedule: the table only matters
 * when someone reads it, and it grows by a few rows an hour.
 */
export async function queryTelemetry(windowHours: number): Promise<TelemetryReport> {
	const hours = Math.min(Math.max(Math.trunc(windowHours) || 1, 1), MAX_HOURS);
	const now = Date.now();
	const currentHour = Math.floor(now / HOUR_MS);
	try {
		const db = getDb();
		await db.ready;
		await db.ops.execute({
			sql: 'DELETE FROM activity_hours WHERE hour <= ?',
			args: [currentHour - MAX_HOURS - 1]
		});
		const { rows } = await db.ops.execute({
			sql: 'SELECT key, SUM(value) AS total FROM activity_hours WHERE hour > ? GROUP BY key',
			args: [currentHour - hours]
		});
		const totals = new Map(rows.map((row) => [String(row.key), Number(row.total) || 0]));
		const count = (key: string) => Math.round(totals.get(key) ?? 0);
		const activity: ActivityCounts = {
			syncRequests: count('sync'),
			syncUploadEnvelopes: count('uploads'),
			syncDeleteSlots: count('deletes'),
			sqliteBusy: count('storage_busy'),
			reminderWakesSent: count('wake_sent'),
			reminderWakesGone: count('wake_gone'),
			reminderWakesFailed: count('wake_failed')
		};
		const http = [...totals.keys()]
			.filter((key) => key.startsWith('http '))
			.map((key) => {
				const bucket = key.slice('http '.length);
				const split = bucket.lastIndexOf(' ');
				return {
					route: bucket.slice(0, split),
					status: bucket.slice(split + 1),
					count: count(key),
					durationMs: totals.get(`http_ms ${bucket}`) ?? 0
				};
			});
		return {
			available: true,
			source: 'database',
			windowHours: hours,
			activity,
			throttledNow: await countThrottledCallers(db, now),
			http,
			note: 'Requests are counted only when they fail with a server error.'
		};
	} catch (error) {
		console.error(
			JSON.stringify({
				level: 'error',
				event: 'telemetry_query_failed',
				message: error instanceof Error ? error.message : 'Telemetry query failed'
			})
		);
		return {
			available: false,
			source: 'database',
			windowHours: hours,
			activity: null,
			throttledNow: null,
			http: [],
			note: 'Could not read activity; see logs.'
		};
	}
}
