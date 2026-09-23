import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getSyncAuth } from '$lib/server/syncAuth';
import { getSyncStore } from '$lib/server/syncStore';
import { clientAddress, getPublicApiLimiter, rateLimitResponse } from '$lib/server/rateLimit';

const privateResponse = (body: unknown, status = 200) =>
	json(body, { status, headers: { 'cache-control': 'no-store' } });

export const GET: RequestHandler = async ({ request, url, getClientAddress }) => {
	const limit = await getPublicApiLimiter().check(`history-ip:${clientAddress(getClientAddress)}`, {
		capacity: 120,
		refillWindowMs: 60_000
	});
	if (!limit.allowed) return rateLimitResponse(limit);
	const accountId = await getSyncAuth().authenticateSyncRequest(request);
	if (!accountId) return privateResponse({ error: 'Invalid sync session' }, 401);
	const beforeText = url.searchParams.get('before');
	const idText = url.searchParams.get('id');
	const slot = url.searchParams.get('slot');
	const noteSlot = url.searchParams.get('noteSlot');
	const atText = url.searchParams.get('at');
	if (
		(noteSlot !== null && !/^[a-f0-9]{64}$/.test(noteSlot)) ||
		(slot !== null &&
			(!/^[a-f0-9]{64}$/.test(slot) ||
				atText === null ||
				!/^\d+$/.test(atText) ||
				!Number.isSafeInteger(Number(atText))))
	) {
		return privateResponse({ error: 'Invalid history lookup' }, 400);
	}
	if (idText === null && slot === null && noteSlot === null)
		return privateResponse({ error: 'A note slot is required to list history' }, 400);
	const value = idText ?? beforeText;
	if (value !== null && (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) {
		return privateResponse({ error: 'Invalid history cursor' }, 400);
	}
	try {
		const store = getSyncStore();
		if (slot !== null) {
			const envelope = await store.getEnvelopeAt(accountId, slot, Number(atText));
			return envelope
				? privateResponse(envelope)
				: privateResponse({ error: 'Envelope not found' }, 404);
		}
		if (idText !== null) {
			const envelope = await store.getHistory(accountId, Number(idText));
			return envelope
				? privateResponse(envelope)
				: privateResponse({ error: 'History entry not found' }, 404);
		}
		return privateResponse(
			await store.listHistory(
				accountId,
				noteSlot!,
				beforeText === null ? undefined : Number(beforeText)
			)
		);
	} catch {
		return privateResponse({ error: 'Sync history is temporarily unavailable' }, 503);
	}
};
