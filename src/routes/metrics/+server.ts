import type { RequestHandler } from './$types';
import { isAdminAuthorized, unauthorizedAdminResponse } from '$lib/server/adminAuth';
import { metricsSnapshot, renderMetrics } from '$lib/server/metrics';
import { bytesToGigabytes, staleBeforeMs } from '$lib/server/operatorConfig';
import { getRetentionStatus } from '$lib/server/retentionSweep';
import { getRuntimeSettings } from '$lib/server/runtimeSettings';
import { getSyncStore } from '$lib/server/syncStore';

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
