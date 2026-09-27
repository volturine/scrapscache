import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getSyncAuth } from '$lib/server/syncAuth';
import { clientAddress, getPublicApiLimiter, rateLimitResponse } from '$lib/server/rateLimit';
import { openReminderEvents } from '$lib/server/reminderEvents';
import { validReminderClientId } from '$lib/server/reminderEventStream';

export const GET: RequestHandler = async ({ request, url, getClientAddress }) => {
	const limited = await getPublicApiLimiter().check(
		`reminder-events-ip:${clientAddress(getClientAddress)}`,
		{ capacity: 120, refillWindowMs: 60_000 }
	);
	if (!limited.allowed) return rateLimitResponse(limited);
	const accountId = await getSyncAuth().authenticateSyncRequest(request);
	if (!accountId) return json({ error: 'Invalid sync session' }, { status: 401 });
	const clientId = url.searchParams.get('clientId') ?? undefined;
	if (clientId !== undefined && !validReminderClientId(clientId))
		return json({ error: 'Invalid client id' }, { status: 400 });
	return openReminderEvents(accountId, request.signal, clientId);
};
