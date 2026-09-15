import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getSyncStore } from '$lib/server/syncStore';
import { getSyncAuth } from '$lib/server/syncAuth';
import { clientAddress, getPublicApiLimiter, rateLimitResponse } from '$lib/server/rateLimit';

/**
 * Which gated features this account may use. Read once when the app starts, not
 * on the sync path, so an offline client keeps whatever it last knew and a gate
 * nobody has declared is simply absent.
 */
export const GET: RequestHandler = async ({ request, getClientAddress }) => {
	const limited = await getPublicApiLimiter().check(`features:${clientAddress(getClientAddress)}`, {
		capacity: 30,
		refillWindowMs: 60_000
	});
	if (!limited.allowed) return rateLimitResponse(limited);

	const accountId = await getSyncAuth().authenticateSyncRequest(request);
	if (!accountId) return json({ error: 'Invalid sync session' }, { status: 401 });

	try {
		return json(
			{ flags: await getSyncStore().accountFeatureFlags(accountId) },
			{ headers: { 'cache-control': 'no-store' } }
		);
	} catch {
		// A gate that cannot be read is a gate that stays shut, which is the safe
		// direction for something unreleased.
		return json({ flags: {} }, { headers: { 'cache-control': 'no-store' } });
	}
};
