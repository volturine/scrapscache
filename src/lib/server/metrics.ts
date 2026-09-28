import type { HttpSample, MetricsSnapshot, ProcessActivity } from '$lib/server/metricsRender';
import { createSyncTimings, type SyncPhase, type SyncTimings } from '$lib/server/syncMetrics';

/** Per-phase timings for one relay sync round; empty where nothing ran. */
export function recordSyncPhases(phases: Record<string, number>): void {
	for (const [key, value] of Object.entries(phases)) {
		const metric = phaseMetrics.get(key) ?? { totalMs: 0, calls: 0 };
		if (key.startsWith('sync_ms ')) metric.totalMs += value;
		else if (key.startsWith('sync_calls ')) metric.calls += value;
		phaseMetrics.set(key, metric);
	}
}

export { renderMetrics } from '$lib/server/metricsRender';
export type { ProcessActivity, MetricsSnapshot } from '$lib/server/metricsRender';

/** One Node process serves every request, so in-memory counters are the whole
 * story here. The Workers build swaps this module for one that keeps hourly
 * counters in D1, because there no single isolate sees them all. */
type HttpMetric = { count: number; durationMs: number };

const http = new Map<string, HttpMetric>();
let rateLimited = 0;
let syncRequests = 0;
let syncUploadEnvelopes = 0;
let syncDeleteSlots = 0;
let sqliteBusy = 0;
let reminderWakesSent = 0;
let reminderWakesGone = 0;
let reminderWakesFailed = 0;

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

export function processActivity(): ProcessActivity {
	return {
		syncRequests,
		syncUploadEnvelopes,
		syncDeleteSlots,
		rateLimited,
		sqliteBusy,
		reminderWakesSent,
		reminderWakesGone,
		reminderWakesFailed
	};
}

function httpSamples(): HttpSample[] {
	return [...http].map(([key, metric]) => {
		const [route, status] = key.split(' ');
		return { route, status, count: metric.count, durationMs: metric.durationMs };
	});
}

export function metricsSnapshot(): MetricsSnapshot {
	return { http: httpSamples(), activity: processActivity() };
}

export function recordHttpRequest(pathname: string, status: number, durationMs: number): void {
	const key = `${routeLabel(pathname)} ${status}`;
	const metric = http.get(key) ?? { count: 0, durationMs: 0 };
	metric.count += 1;
	metric.durationMs += durationMs;
	http.set(key, metric);
}

export function recordRateLimit(): void {
	rateLimited += 1;
}

export function recordSyncBatch(uploadCount: number, deleteCount: number): void {
	syncRequests += 1;
	syncUploadEnvelopes += uploadCount;
	syncDeleteSlots += deleteCount;
}

/** One relay sync round's per-phase timings, counted in this process's memory. */
export function createSyncTimingRecorder(): SyncTimings & { flush(): void } {
	const timings = createSyncTimings();
	return {
		start(phase: SyncPhase) {
			timings.start(phase);
		},
		stop(phase: SyncPhase) {
			timings.stop(phase);
		},
		count(phase: SyncPhase, calls: number) {
			timings.count(phase, calls);
		},
		timings: timings.timings,
		flush() {
			for (const [key, value] of Object.entries(timings.timings())) {
				const metric = phaseMetrics.get(key) ?? { totalMs: 0, calls: 0 };
				if (key.startsWith('sync_ms ')) metric.totalMs += value;
				else if (key.startsWith('sync_calls ')) metric.calls += value;
				phaseMetrics.set(key, metric);
			}
		}
	};
}

const phaseMetrics = new Map<string, { totalMs: number; calls: number }>();

/** Per-phase timings for the admin telemetry view; empty until a sync ran. */
export function syncPhaseSamples(): Array<{ phase: string; totalMs: number; calls: number }> {
	return [...phaseMetrics]
		.filter(([key]) => key.startsWith('sync_ms '))
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, metric]) => ({
			phase: key.slice('sync_ms phase:'.length),
			totalMs: metric.totalMs,
			calls: metric.calls
		}));
}

export function recordSqliteBusy(): void {
	sqliteBusy += 1;
}

export function recordReminderWake(result: 'sent' | 'gone' | 'failed'): void {
	if (result === 'sent') reminderWakesSent += 1;
	else if (result === 'gone') reminderWakesGone += 1;
	else reminderWakesFailed += 1;
}

export function recordSqliteError(error: unknown): void {
	if (
		error instanceof Error &&
		(error.message.includes('SQLITE_BUSY') || error.message.includes('database is locked'))
	)
		recordSqliteBusy();
}
