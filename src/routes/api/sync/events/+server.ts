import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getSyncStore } from '$lib/server/syncStore';
import { getSyncAuth } from '$lib/server/syncAuth';
import { clientAddress, getPublicApiLimiter, rateLimitResponse } from '$lib/server/rateLimit';
import { syncEventsToken, validSyncClientId } from '$lib/syncEventsProtocol';

/**
 * Live note-sync change signals: a hibernating WebSocket on Workers, server-sent
 * events on Node. Both carry only the new cursor, never ciphertext.
 */
export const GET: RequestHandler = async ({ request, url, getClientAddress }) => {
	const addressLimit = await getPublicApiLimiter().check(
		`sync-events-ip:${clientAddress(getClientAddress)}`,
		{
			capacity: 60,
			refillWindowMs: 60_000
		}
	);
	if (!addressLimit.allowed) return rateLimitResponse(addressLimit);

	const requestedClientId = url.searchParams.get('clientId');
	if (requestedClientId !== null && !validSyncClientId(requestedClientId))
		return json({ error: 'Invalid client id' }, { status: 400 });
	const clientId = requestedClientId ?? undefined;

	if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
		// Browsers send Origin on every WebSocket; another site's page must not open one here.
		if (request.headers.get('origin') !== url.origin)
			return json({ error: 'Cross-origin socket refused' }, { status: 403 });
		const token = syncEventsToken(request.headers.get('sec-websocket-protocol'));
		const session = token ? await getSyncAuth().authenticateSyncToken(token) : null;
		if (!session) return json({ error: 'Invalid sync session' }, { status: 401 });
		return getSyncStore().createEventSocket(session.accountId, session.expiresAt, clientId);
	}

	const accountId = await getSyncAuth().authenticateSyncRequest(request);
	if (!accountId) return json({ error: 'Invalid sync session' }, { status: 401 });
	return getSyncStore().createEventStream(accountId, request.signal, clientId);
};
