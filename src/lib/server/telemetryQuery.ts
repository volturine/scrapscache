import { getDb } from '#lib/server/db.js';
import { metricsSnapshot } from '#lib/server/metrics.js';
import type { HttpSample, ProcessActivity } from '#lib/server/metricsRender.js';
import { countThrottledCallers } from '#lib/server/rateLimit.js';

export type ActivityCounts = Omit<ProcessActivity, 'rateLimited'>;

export type TelemetryReport = {
	/** False when this deployment has no counters to report. */
	available: boolean;
	source: 'process' | 'database';
	/** Null when the numbers are process-lifetime rather than windowed. */
	windowHours: number | null;
	activity: ActivityCounts | null;
	/** Callers being refused right now, read from the rate-limit buckets. */
	throttledNow: number | null;
	http: HttpSample[];
	note?: string;
};

async function throttledNow(): Promise<number | null> {
	try {
		return await countThrottledCallers(getDb());
	} catch {
		return null;
	}
}

/** One process has seen every request it served, so the window is its own
 * lifetime and there is nothing to query. */
export async function queryTelemetry(_windowHours: number): Promise<TelemetryReport> {
	const snapshot = metricsSnapshot();
	if (!snapshot) {
		return {
			available: false,
			source: 'process',
			windowHours: null,
			activity: null,
			throttledNow: await throttledNow(),
			http: [],
			note: 'No counters available in this process.'
		};
	}
	const counters = snapshot.activity;
	return {
		available: true,
		source: 'process',
		windowHours: null,
		activity: {
			syncRequests: counters.syncRequests,
			syncUploadEnvelopes: counters.syncUploadEnvelopes,
			syncDeleteSlots: counters.syncDeleteSlots,
			sqliteBusy: counters.sqliteBusy,
			reminderWakesSent: counters.reminderWakesSent,
			reminderWakesGone: counters.reminderWakesGone,
			reminderWakesFailed: counters.reminderWakesFailed
		},
		throttledNow: await throttledNow(),
		http: snapshot.http
	};
}
