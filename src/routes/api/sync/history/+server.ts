import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getSyncAuth } from '$lib/server/syncAuth';
import { getSyncStore } from '$lib/server/syncStore';
import { clientAddress, getPublicApiLimiter, rateLimitResponse } from '$lib/server/rateLimit';

const privateResponse = (body: unknown, status = 200) =>
	json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * `?slot=` lists a record's retained encrypted versions, newest first, in one response.
 * `?slot=&at=` returns the version saved at or after `at`, else the live one.
 */
export const GET: RequestHandler = async ({ request, url, getClientAddress }) => {
	const limit = await getPublicApiLimiter().check(`history-ip:${clientAddress(getClientAddress)}`, {
		capacity: 120,
		refillWindowMs: 60_000
	});
	if (!limit.allowed) return rateLimitResponse(limit);
	const accountId = await getSyncAuth().authenticateSyncRequest(request);
	if (!accountId) return privateResponse({ error: 'Invalid sync session' }, 401);
	const slot = url.searchParams.get('slot');
	const atText = url.searchParams.get('at');
	if (
		slot === null ||
		!/^[a-f0-9]{64}$/.test(slot) ||
		(atText !== null && (!/^\d+$/.test(atText) || !Number.isSafeInteger(Number(atText))))
	) {
		return privateResponse({ error: 'Invalid history lookup' }, 400);
	}
	try {
		const store = getSyncStore();
		if (atText === null) return privateResponse(await store.listHistory(accountId, slot));
		const envelope = await store.getEnvelopeAt(accountId, slot, Number(atText));
		return envelope
			? privateResponse(envelope)
			: privateResponse({ error: 'Envelope not found' }, 404);
	} catch {
		return privateResponse({ error: 'Sync history is temporarily unavailable' }, 503);
	}
};
