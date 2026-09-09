import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getSyncStore } from '$lib/server/syncStore';
import { getSyncAuth } from '$lib/server/syncAuth';
import { clientAddress, getPublicApiLimiter, rateLimitResponse } from '$lib/server/rateLimit';

export const GET: RequestHandler = async ({ request, url, getClientAddress }) => {
	const addressLimit = await getPublicApiLimiter().check(
		`sync-events-ip:${clientAddress(getClientAddress)}`,
		{
			capacity: 60,
			refillWindowMs: 60_000
		}
	);
	if (!addressLimit.allowed) return rateLimitResponse(addressLimit);

	const accountId = await getSyncAuth().authenticateSyncRequest(request);
	if (!accountId) return json({ error: 'Invalid sync session' }, { status: 401 });

	const clientId = url.searchParams.get('clientId') ?? undefined;
	return getSyncStore().createEventStream(accountId, request.signal, clientId);
};
