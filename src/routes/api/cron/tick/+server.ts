import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isAdminAuthorized, unauthorizedAdminResponse } from '$lib/server/adminAuth';
import { clientAddress, getPublicApiLimiter, rateLimitResponse } from '$lib/server/rateLimit';
import { runCronTick } from '$lib/server/cronTick';

/** Scheduler entry point for Workers Cron Triggers and self-host crontabs. */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	// The route is public, so throttle before comparing the secret. The scheduler
	// Worker arrives over a service binding with no client address and shares the
	// fallback bucket; one tick a minute leaves it ample headroom.
	const limited = await getPublicApiLimiter().check(`cron:${clientAddress(getClientAddress)}`, {
		capacity: 30,
		refillWindowMs: 60_000
	});
	if (!limited.allowed) return rateLimitResponse(limited);
	if (!env.SCRAPSCACHE_TICK_SECRET) return unauthorizedAdminResponse();
	if (!isAdminAuthorized(request, env.SCRAPSCACHE_TICK_SECRET)) return unauthorizedAdminResponse();
	try {
		return json(await runCronTick(), { headers: { 'cache-control': 'no-store' } });
	} catch (error) {
		console.error(
			JSON.stringify({
				level: 'error',
				event: 'cron_tick_failed',
				message: error instanceof Error ? error.message : 'Cron tick failed'
			})
		);
		return json({ error: 'Cron tick failed' }, { status: 503 });
	}
};
