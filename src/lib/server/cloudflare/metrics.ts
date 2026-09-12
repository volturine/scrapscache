import { getRequestEvent } from '$app/server';
import type { MetricsSnapshot, ProcessActivity } from '$lib/server/metricsRender';

export { renderMetrics } from '$lib/server/metricsRender';
export type { ProcessActivity, MetricsSnapshot } from '$lib/server/metricsRender';

/** Dataset the Worker writes operational events to, read back by
 * /api/admin/telemetry. */
export const ANALYTICS_DATASET = 'scrapscache_events';

type AnalyticsEngineDataset = {
	writeDataPoint(event: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
};

export function routeLabel(pathname: string): string {
	if (pathname.startsWith('/api/sync/delta')) return '/api/sync/delta';
	if (pathname.startsWith('/api/sync/push/')) return '/api/sync/push/*';
	if (pathname.startsWith('/api/sync/pair/')) return '/api/sync/pair/*';
	if (pathname.startsWith('/api/sync/')) return '/api/sync/*';
	if (pathname.startsWith('/api/admin/')) return '/api/admin/*';
	if (pathname.startsWith('/health/')) return '/health/*';
	if (pathname === '/metrics') return '/metrics';
	return 'app';
}

/**
 * Telemetry must never be the reason a request fails, and it is also called from
 * places with no request context, such as a scheduled tick that outlived its
 * event. Both cases resolve to "no dataset", not to an error.
 */
function dataset(): AnalyticsEngineDataset | null {
	try {
		const bindings = (getRequestEvent().platform as { env?: Record<string, unknown> } | undefined)
			?.env;
		const binding = bindings?.SCRAPSCACHE_ANALYTICS;
		return binding ? (binding as AnalyticsEngineDataset) : null;
	} catch {
		return null;
	}
}

function write(event: string, blobs: string[], doubles: number[]): void {
	try {
		dataset()?.writeDataPoint({ indexes: [event], blobs: [event, ...blobs], doubles });
	} catch {
		// A dropped data point is not worth failing a request over.
	}
}

/**
 * No isolate on Workers accumulates a meaningful total: they are short-lived and
 * there are many at once, so whatever one of them happened to count is not the
 * figure an operator wants. Counters go to the dataset; this reports nothing
 * rather than something misleading.
 */
export function processActivity(): ProcessActivity | null {
	return null;
}

export function metricsSnapshot(): MetricsSnapshot {
	return null;
}

export function recordHttpRequest(pathname: string, status: number, durationMs: number): void {
	write('http', [routeLabel(pathname), String(status)], [1, durationMs]);
}

export function recordRateLimit(): void {
	write('rate_limited', [], [1]);
}

export function recordSyncBatch(uploadCount: number, deleteCount: number): void {
	write('sync_batch', [], [1, uploadCount, deleteCount]);
}

export function recordSqliteBusy(): void {
	write('storage_busy', [], [1]);
}

export function recordReminderWake(result: 'sent' | 'gone' | 'failed'): void {
	write('reminder_wake', [result], [1]);
}

export function recordSqliteError(error: unknown): void {
	if (
		error instanceof Error &&
		(error.message.includes('SQLITE_BUSY') || error.message.includes('database is locked'))
	)
		recordSqliteBusy();
}
