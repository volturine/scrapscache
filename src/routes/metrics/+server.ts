import type { RequestHandler } from './$types';
import { isAdminAuthorized, unauthorizedAdminResponse } from '#lib/server/adminAuth.js';
import { metricsSnapshot, renderMetrics } from '#lib/server/metrics.js';
import { bytesToGigabytes, staleBeforeMs } from '#lib/server/operatorConfig.js';
import { getRetentionStatus } from '#lib/server/retentionSweep.js';
import { getRuntimeSettings } from '#lib/server/runtimeSettings.js';
import { getSyncStore } from '#lib/server/syncStore.js';

export const GET: RequestHandler = async ({ request }) => {
	if (!isAdminAuthorized(request)) return unauthorizedAdminResponse();
	const now = Date.now();
	const settings = await getRuntimeSettings();
	const usage = await getSyncStore().operatorUsage({
		now,
		staleBefore: staleBeforeMs(settings.retentionInactiveDays, now)
	});
	return new Response(
		renderMetrics(
			{
				...usage,
				gigabytes: bytesToGigabytes(usage.storageBytes)
			},
			await getRetentionStatus(undefined, settings.retentionInactiveDays),
			metricsSnapshot()
		),
		{
			headers: {
				'content-type': 'text/plain; version=0.0.4; charset=utf-8',
				'cache-control': 'no-store'
			}
		}
	);
};
