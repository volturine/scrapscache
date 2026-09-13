import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getSharedNotes } from '$lib/server/sharedNotes';
import { clientAddress, getPublicApiLimiter, rateLimitResponse } from '$lib/server/rateLimit';

export const GET: RequestHandler = async ({ params, getClientAddress }) => {
	const limited = await getPublicApiLimiter().check(
		`share-get:${clientAddress(getClientAddress)}`,
		{
			capacity: 120,
			refillWindowMs: 60_000
		}
	);
	if (!limited.allowed) return rateLimitResponse(limited);

	const id = params.id;
	if (!id || typeof id !== 'string' || id.length > 128) {
		return json({ error: 'Invalid share ID' }, { status: 400 });
	}

	const record = await getSharedNotes().get(id);
	if (!record) {
		return json(
			{ error: 'Note not found or expired' },
			{
				status: 404,
				headers: {
					'cache-control': 'no-store, no-cache, must-revalidate, max-age=0'
				}
			}
		);
	}

	return json(
		{
			ciphertext: record.ciphertext,
			burnAfterReading: record.burnAfterReading,
			expiresAt: record.expiresAt
		},
		{
			headers: {
				'cache-control': 'no-store, no-cache, must-revalidate, max-age=0'
			}
		}
	);
};
