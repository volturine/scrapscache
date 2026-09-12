import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('$env/dynamic/private', () => ({ env: envMock }));

import { queryTelemetry } from './telemetryQuery';

const httpRows = [{ route: '/api/sync/delta', status: '200', count: 120, duration: 2400 }];
const eventRows = [
	{ event: 'sync_batch', detail: '', count: 30, second: 90, third: 12 },
	{ event: 'rate_limited', detail: '', count: 7 },
	{ event: 'storage_busy', detail: '', count: 2 },
	{ event: 'reminder_wake', detail: 'sent', count: 40 },
	{ event: 'reminder_wake', detail: 'gone', count: 3 },
	{ event: 'reminder_wake', detail: 'failed', count: 1 }
];

let queries: string[];

beforeEach(() => {
	queries = [];
	envMock.SCRAPSCACHE_CF_ACCOUNT_ID = 'account-id';
	envMock.SCRAPSCACHE_ANALYTICS_TOKEN = 'analytics-token';
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init: { body: string }) => {
			queries.push(init.body);
			const data = init.body.includes("blob1 = 'http'") ? httpRows : eventRows;
			return new Response(JSON.stringify({ data }), { status: 200 });
		})
	);
});

afterEach(() => {
	delete envMock.SCRAPSCACHE_CF_ACCOUNT_ID;
	delete envMock.SCRAPSCACHE_ANALYTICS_TOKEN;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('reading counters back out of the dataset', () => {
	it('maps event rows onto the activity an operator alerts on', async () => {
		const report = await queryTelemetry(24);

		expect(report.available).toBe(true);
		expect(report.source).toBe('dataset');
		expect(report.windowHours).toBe(24);
		expect(report.activity).toEqual({
			syncRequests: 30,
			syncUploadEnvelopes: 90,
			syncDeleteSlots: 12,
			rateLimited: 7,
			sqliteBusy: 2,
			reminderWakesSent: 40,
			reminderWakesGone: 3,
			reminderWakesFailed: 1
		});
		expect(report.http).toEqual([
			{ route: '/api/sync/delta', status: '200', count: 120, durationMs: 2400 }
		]);
	});

	it('weights every sum by the sample interval', async () => {
		await queryTelemetry(1);
		// Summing the raw column undercounts precisely when traffic is heavy enough
		// for Analytics Engine to start sampling.
		for (const query of queries) {
			expect(query).toContain('_sample_interval');
			expect(query).not.toMatch(/sum\(double\d\)/);
		}
	});

	it('clamps the window instead of trusting the caller', async () => {
		expect((await queryTelemetry(0)).windowHours).toBe(1);
		expect((await queryTelemetry(100_000)).windowHours).toBe(168);
		expect(queries.at(-1)).toContain("INTERVAL '168' HOUR");
	});

	it('reports unavailable, and says why, when no API credentials are set', async () => {
		delete envMock.SCRAPSCACHE_ANALYTICS_TOKEN;
		const report = await queryTelemetry(24);

		expect(report.available).toBe(false);
		expect(report.activity).toBeNull();
		expect(report.note).toContain('SCRAPSCACHE_ANALYTICS_TOKEN');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('degrades to unavailable rather than throwing when the query fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 403 }))
		);
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});

		const report = await queryTelemetry(24);

		expect(report.available).toBe(false);
		expect(report.activity).toBeNull();
		const logged = String(error.mock.calls[0]?.[0]);
		expect(logged).toContain('telemetry_query_failed');
		expect(logged).not.toContain('analytics-token');
	});
});
