import type { MetricsSnapshot, ProcessActivity } from '#lib/server/metricsRender.js';

export { renderMetrics } from '#lib/server/metricsRender.js';
export type { ProcessActivity, MetricsSnapshot } from '#lib/server/metricsRender.js';

/**
 * Workers keeps no counters of its own. No isolate sees every request, and
 * counting them in D1 made every request pay a database write for numbers
 * Cloudflare already records: request counts, status codes and durations are in
 * the Worker's analytics, failures in Workers Logs, and statement costs in D1's
 * query insights.
 */
export function processActivity(): ProcessActivity | null {
	return null;
}

export function metricsSnapshot(): MetricsSnapshot {
	return null;
}

export function recordHttpRequest(_pathname: string, _status: number, _durationMs: number): void {}

export function recordRateLimit(): void {}

export function recordSyncBatch(_uploadCount: number, _deleteCount: number): void {}

export function recordSqliteBusy(): void {}

export function recordReminderWake(_result: 'sent' | 'gone' | 'failed'): void {}

export function recordSqliteError(_error: unknown): void {}
