import type { RequestHandler } from './$types';
import { requireAdmin } from '#lib/server/adminAuth.js';
import { queryTelemetry } from '#lib/server/telemetryQuery.js';

/** Request counts and operational counters over a window, from wherever this
 * deployment keeps them. Aggregates only, same as the rest of the admin API. */
export const GET: RequestHandler = async ({ request, url, getClientAddress }) => {
	const rejected = await requireAdmin(request, getClientAddress);
	if (rejected) return rejected;
	const hours = Number(url.searchParams.get('hours'));
	return Response.json(await queryTelemetry(Number.isFinite(hours) && hours > 0 ? hours : 24), {
		headers: { 'cache-control': 'no-store' }
	});
};
