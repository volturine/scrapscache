import { env, waitUntil } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import type { MetricsSnapshot, ProcessActivity } from '#lib/server/metricsRender.js';
import { SYNC_DELTA_PATH } from '#lib/model/protocol.js';

export { renderMetrics } from '#lib/server/metricsRender.js';
export type { ProcessActivity, MetricsSnapshot } from '#lib/server/metricsRender.js';

export const HOUR_MS = 3_600_000;

export function routeLabel(pathname: string): string {
	if (pathname.startsWith(SYNC_DELTA_PATH)) return SYNC_DELTA_PATH;
	if (pathname.startsWith('/api/sync/push/')) return '/api/sync/push/*';
	if (pathname.startsWith('/api/sync/pair/')) return '/api/sync/pair/*';
	if (pathname.startsWith('/api/sync/')) return '/api/sync/*';
	if (pathname.startsWith('/api/admin/')) return '/api/admin/*';
	if (pathname.startsWith('/health/')) return '/health/*';
	if (pathname === '/metrics') return '/metrics';
	return 'app';
}

const INCREMENT_SQL = `INSERT INTO activity_hours(hour, key, value) VALUES (?, ?, ?)
	ON CONFLICT(hour, key) DO UPDATE SET value = value + excluded.value`;

/**
 * Adds to this hour's counters in D1, after the response. Nothing here may be the
 * reason a request fails or slows down, and it is also reached from places with
 * no request context, such as a scheduled tick that outlived its event: every one
 * of those resolves to "not recorded", never to an error.
 */
function add(counts: Record<string, number>, now = Date.now()): void {
	try {
		const db = env.SCRAPSCACHE_DB as D1Database | undefined;
		if (!db) return;
		const hour = Math.floor(now / HOUR_MS);
		const statements = Object.entries(counts)
			.filter(([, value]) => value > 0)
			.map(([key, value]) => db.prepare(INCREMENT_SQL).bind(hour, key, value));
		if (statements.length === 0) return;
		waitUntil(db.batch(statements).catch(() => undefined));
	} catch {
		// A dropped count is not worth failing a request over.
	}
}

/**
 * No isolate on Workers accumulates a meaningful total: they are short-lived and
 * there are many at once, so whatever one of them happened to count is not the
 * figure an operator wants. Counters go to D1; this reports nothing rather than
 * something misleading.
 */
export function processActivity(): ProcessActivity | null {
	return null;
}

export function metricsSnapshot(): MetricsSnapshot {
	return null;
}

/** Only server errors are counted. Every request writing to D1 would make each one
 * cost a database write, and the healthy ones are what Cloudflare's own dashboard
 * already shows. */
export function recordHttpRequest(pathname: string, status: number, durationMs: number): void {
	if (status < 500) return;
	const bucket = `${routeLabel(pathname)} ${status}`;
	add({ [`http ${bucket}`]: 1, [`http_ms ${bucket}`]: durationMs });
}

/** Deliberately not counted here. A refused request must cost as little as
 * possible, and a write per refusal would hand a flood a database write for
 * each one. The rate-limit buckets already show who is being held back. */
export function recordRateLimit(): void {}

/**
 * Sync rounds are counted one in this many, each standing for the rest. Most rounds
 * change nothing, and counting every one would make each of them a database write.
 */
export const SYNC_ROUND_SAMPLE = 20;

/** Uploads and deletions are counted exactly; a round that has them is writing anyway. */
export function recordSyncBatch(uploadCount: number, deleteCount: number): void {
	add({
		sync: Math.random() * SYNC_ROUND_SAMPLE < 1 ? SYNC_ROUND_SAMPLE : 0,
		uploads: uploadCount,
		deletes: deleteCount
	});
}

export function recordSqliteBusy(): void {
	add({ storage_busy: 1 });
}

export function recordReminderWake(result: 'sent' | 'gone' | 'failed'): void {
	add({ [`wake_${result}`]: 1 });
}

export function recordSqliteError(error: unknown): void {
	if (
		error instanceof Error &&
		(error.message.includes('SQLITE_BUSY') || error.message.includes('database is locked'))
	)
		recordSqliteBusy();
}
