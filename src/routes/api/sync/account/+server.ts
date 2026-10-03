import type { RequestHandler } from './$types';
import { getSyncStore } from '#lib/server/syncStore.js';
import { getSyncAuth } from '#lib/server/syncAuth.js';
import { clientAddress, getPublicApiLimiter, rateLimitResponse } from '#lib/server/rateLimit.js';

export const DELETE: RequestHandler = async ({ request, getClientAddress }) => {
	const limited = await getPublicApiLimiter().check(
		`delete-account:${clientAddress(getClientAddress)}`,
		{
			capacity: 5,
			refillWindowMs: 60 * 60 * 1000
		}
	);
	if (!limited.allowed) return rateLimitResponse(limited);
	const accountId = await getSyncAuth().authenticateSyncRequest(request);
	if (!accountId) return Response.json({ error: 'Account could not be deleted' }, { status: 401 });
	try {
		const store = getSyncStore();
		// Deleting cloud data retires the key: any device still holding it, a lost
		// one included, is told to make a new key instead of recreating this account.
		await store.retireAccount(accountId);
		await store.deleteAccount(accountId);
		await getSyncAuth().revokeSyncSessions(accountId);
		return new Response(null, { status: 204 });
	} catch (error) {
		console.error(
			JSON.stringify({
				level: 'error',
				event: 'account_deletion_failed',
				message: error instanceof Error ? error.message : 'Account deletion failed'
			})
		);
		return Response.json({ error: 'Sync storage is temporarily unavailable' }, { status: 503 });
	}
};
