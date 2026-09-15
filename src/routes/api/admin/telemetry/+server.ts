import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/adminAuth';
import { queryTelemetry } from '$lib/server/telemetryQuery';

/** Request counts and operational counters over a window, from wherever this
 * deployment keeps them. Aggregates only, same as the rest of the admin API. */
export const GET: RequestHandler = async ({ request, url, getClientAddress }) => {
	const rejected = await requireAdmin(request, getClientAddress);
	if (rejected) return rejected;
	const hours = Number(url.searchParams.get('hours'));
	return json(await queryTelemetry(Number.isFinite(hours) && hours > 0 ? hours : 24), {
		headers: { 'cache-control': 'no-store' }
	});
};
