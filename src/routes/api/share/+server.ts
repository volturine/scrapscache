import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getSharedNotes, MAX_CIPHERTEXT_LENGTH } from '$lib/server/sharedNotes';
import { readJsonBody } from '$lib/server/request';
import { clientAddress, getPublicApiLimiter, rateLimitResponse } from '$lib/server/rateLimit';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const limited = await getPublicApiLimiter().check(
		`share-create:${clientAddress(getClientAddress)}`,
		{
			capacity: 60,
			refillWindowMs: 60_000
		}
	);
	if (!limited.allowed) return rateLimitResponse(limited);

	let body: { ciphertext?: unknown; burnAfterReading?: unknown; expiresInMs?: unknown };
	try {
		body = (await readJsonBody(request, MAX_CIPHERTEXT_LENGTH + 1024)) as typeof body;
	} catch {
		return json({ error: 'Invalid JSON body or payload too large' }, { status: 400 });
	}

	if (typeof body.ciphertext !== 'string' || !body.ciphertext.trim()) {
		return json({ error: 'ciphertext must be a non-empty string' }, { status: 400 });
	}

	const burnAfterReading = Boolean(body.burnAfterReading);
	const expiresInMs = typeof body.expiresInMs === 'number' ? body.expiresInMs : undefined;

	try {
		const created = await getSharedNotes().create({
			ciphertext: body.ciphertext,
			burnAfterReading,
			expiresInMs
		});
		return json(created, { status: 201 });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Could not create shared note' },
			{ status: 400 }
		);
	}
};
