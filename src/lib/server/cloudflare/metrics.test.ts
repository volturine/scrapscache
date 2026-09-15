import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type DataPoint = { indexes?: string[]; blobs?: string[]; doubles?: number[] };

const harness = vi.hoisted(() => ({
	points: [] as DataPoint[],
	bound: true,
	throwOutsideRequest: false
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => {
		if (harness.throwOutsideRequest) throw new Error('no request context');
		return {
			platform: {
				env: harness.bound
					? { SCRAPSCACHE_ANALYTICS: { writeDataPoint: (p: DataPoint) => harness.points.push(p) } }
					: {}
			}
		};
	}
}));

import {
	metricsSnapshot,
	processActivity,
	recordHttpRequest,
	recordRateLimit,
	recordReminderWake,
	recordSqliteError,
	recordSyncBatch
} from './metrics';

beforeEach(() => {
	harness.points = [];
	harness.bound = true;
	harness.throwOutsideRequest = false;
});
afterEach(() => vi.clearAllMocks());

describe('Workers telemetry', () => {
	it('reports no process counters, because no isolate has the whole picture', () => {
		expect(processActivity()).toBeNull();
		expect(metricsSnapshot()).toBeNull();
	});

	it('emits a request with its route bucket and status, never its raw path', () => {
		recordHttpRequest('/api/sync/delta', 200, 12.5);

		expect(harness.points).toHaveLength(1);
		expect(harness.points[0].blobs).toEqual(['http', '/api/sync/delta', '200']);
		expect(harness.points[0].doubles).toEqual([1, 12.5]);
		expect(harness.points[0].indexes).toEqual(['http']);
	});

	it('buckets a path that embeds an identifier rather than emitting it', () => {
		recordHttpRequest('/api/sync/push/wakes', 401, 1);
		expect(harness.points[0].blobs?.[1]).toBe('/api/sync/push/*');
	});

	it('emits the operational counters an operator alerts on', () => {
		recordRateLimit();
		recordSyncBatch(3, 2);
		recordReminderWake('failed');
		recordSqliteError(new Error('SQLITE_BUSY: database is locked'));

		expect(harness.points.map((point) => point.blobs?.[0])).toEqual([
			'rate_limited',
			'sync_batch',
			'reminder_wake',
			'storage_busy'
		]);
		expect(harness.points[1].doubles).toEqual([1, 3, 2]);
		expect(harness.points[2].blobs).toEqual(['reminder_wake', 'failed']);
	});

	it('ignores an error that is not storage contention', () => {
		recordSqliteError(new Error('something else entirely'));
		expect(harness.points).toEqual([]);
	});

	it('stays silent rather than failing a request when the dataset is unavailable', () => {
		harness.bound = false;
		expect(() => recordRateLimit()).not.toThrow();

		harness.throwOutsideRequest = true;
		expect(() => recordHttpRequest('/api/sync/delta', 200, 1)).not.toThrow();
		expect(harness.points).toEqual([]);
	});
});
