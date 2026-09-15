import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getSyncAuth, isLegacySyncCredential } from '$lib/server/syncAuth';
import { getSyncStore } from '$lib/server/syncStore';
import { readJsonBody } from '$lib/server/request';
import { clientAddress, getPublicApiLimiter, rateLimitResponse } from '$lib/server/rateLimit';
import { retiredKeyResponse } from '$lib/server/retiredKey';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const limited = await getPublicApiLimiter().check(`auth-ip:${clientAddress(getClientAddress)}`, {
		capacity: 30,
		refillWindowMs: 60_000
	});
	if (!limited.allowed) return rateLimitResponse(limited);
	let body: { accountId?: unknown };
	try {
		body = (await readJsonBody(request, 4_096)) as typeof body;
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	if (typeof body.accountId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(body.accountId)) {
		return json({ error: 'Sync account not found' }, { status: 404 });
	}
	const store = getSyncStore();
	const credential = await store.getAuthCredential(body.accountId);
	if (!credential) {
		if (await store.isAccountRetired(body.accountId)) return retiredKeyResponse();
		return json({ error: 'Sync account not found' }, { status: 404 });
	}
	if (isLegacySyncCredential(credential)) {
		return json(
			{ error: 'Sync authentication upgrade required', migrationRequired: true },
			{ status: 409 }
		);
	}
	return json(await getSyncAuth().createSyncChallenge(body.accountId));
};
