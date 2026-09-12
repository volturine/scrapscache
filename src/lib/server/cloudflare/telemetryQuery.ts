import { env } from '$env/dynamic/private';
import type { HttpSample, ProcessActivity } from '$lib/server/metricsRender';
import { ANALYTICS_DATASET } from './metrics';

export type TelemetryReport = {
	available: boolean;
	source: 'process' | 'dataset';
	windowHours: number | null;
	activity: ProcessActivity | null;
	http: HttpSample[];
	note?: string;
};

const SQL_API = 'https://api.cloudflare.com/client/v4/accounts';

type Row = Record<string, string | number | null>;

function number(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Analytics Engine samples under load and reports the weight of each retained
 * row in `_sample_interval`. Summing the raw column instead would quietly
 * undercount exactly when traffic is high enough to care about.
 */
async function run(accountId: string, token: string, sql: string): Promise<Row[]> {
	const response = await fetch(`${SQL_API}/${accountId}/analytics_engine/sql`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}` },
		body: sql,
		signal: AbortSignal.timeout(10_000)
	});
	if (!response.ok) throw new Error(`Analytics query failed with ${response.status}`);
	const body = (await response.json()) as { data?: Row[] };
	return body.data ?? [];
}

function emptyActivity(): ProcessActivity {
	return {
		syncRequests: 0,
		syncUploadEnvelopes: 0,
		syncDeleteSlots: 0,
		rateLimited: 0,
		sqliteBusy: 0,
		reminderWakesSent: 0,
		reminderWakesGone: 0,
		reminderWakesFailed: 0
	};
}

function activityFrom(rows: Row[]): ProcessActivity {
	const activity = emptyActivity();
	for (const row of rows) {
		const count = number(row.count);
		switch (row.event) {
			case 'sync_batch':
				activity.syncRequests += count;
				activity.syncUploadEnvelopes += number(row.second);
				activity.syncDeleteSlots += number(row.third);
				break;
			case 'rate_limited':
				activity.rateLimited += count;
				break;
			case 'storage_busy':
				activity.sqliteBusy += count;
				break;
			case 'reminder_wake':
				if (row.detail === 'sent') activity.reminderWakesSent += count;
				else if (row.detail === 'gone') activity.reminderWakesGone += count;
				else activity.reminderWakesFailed += count;
				break;
		}
	}
	return activity;
}

/** Reads back what the Worker emitted. Needs an API token, which the Worker has
 * no other use for, so an unconfigured deployment reports unavailable rather
 * than failing: the counters are still being recorded either way. */
export async function queryTelemetry(windowHours: number): Promise<TelemetryReport> {
	const accountId = env.SCRAPSCACHE_CF_ACCOUNT_ID?.trim();
	const token = env.SCRAPSCACHE_ANALYTICS_TOKEN?.trim();
	const hours = Math.min(Math.max(Math.trunc(windowHours) || 1, 1), 168);
	if (!accountId || !token) {
		return {
			available: false,
			source: 'dataset',
			windowHours: hours,
			activity: null,
			http: [],
			note: `Set SCRAPSCACHE_CF_ACCOUNT_ID and SCRAPSCACHE_ANALYTICS_TOKEN to read ${ANALYTICS_DATASET}.`
		};
	}
	const since = `timestamp > now() - INTERVAL '${hours}' HOUR`;
	try {
		const [httpRows, eventRows] = await Promise.all([
			run(
				accountId,
				token,
				`SELECT blob2 AS route, blob3 AS status,
					sum(_sample_interval * double1) AS count,
					sum(_sample_interval * double2) AS duration
				 FROM ${ANALYTICS_DATASET}
				 WHERE blob1 = 'http' AND ${since}
				 GROUP BY route, status`
			),
			run(
				accountId,
				token,
				`SELECT blob1 AS event, blob2 AS detail,
					sum(_sample_interval * double1) AS count,
					sum(_sample_interval * double2) AS second,
					sum(_sample_interval * double3) AS third
				 FROM ${ANALYTICS_DATASET}
				 WHERE blob1 != 'http' AND ${since}
				 GROUP BY event, detail`
			)
		]);
		return {
			available: true,
			source: 'dataset',
			windowHours: hours,
			activity: activityFrom(eventRows),
			http: httpRows.map((row) => ({
				route: String(row.route ?? ''),
				status: String(row.status ?? ''),
				count: number(row.count),
				durationMs: number(row.duration)
			}))
		};
	} catch (error) {
		console.error(
			JSON.stringify({
				level: 'error',
				event: 'telemetry_query_failed',
				message: error instanceof Error ? error.message : 'Analytics query failed'
			})
		);
		return {
			available: false,
			source: 'dataset',
			windowHours: hours,
			activity: null,
			http: [],
			note: 'Analytics query failed; see logs.'
		};
	}
}
