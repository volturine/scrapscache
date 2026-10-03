import type { RequestHandler } from './$types';
import { getPairingSessions } from '#lib/server/pairingSessions.js';
import { readJsonBody } from '#lib/server/request.js';
import { clientAddress, getPublicApiLimiter, rateLimitResponse } from '#lib/server/rateLimit.js';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const limited = await getPublicApiLimiter().check(`pair:${clientAddress(getClientAddress)}`, {
		capacity: 60,
		refillWindowMs: 60_000
	});
	if (!limited.allowed) return rateLimitResponse(limited);
	let body: { sessionId?: unknown };
	try {
		body = (await readJsonBody(request, 4_096)) as typeof body;
	} catch {
		return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	if (typeof body.sessionId !== 'string' || !body.sessionId || body.sessionId.length > 128)
		return Response.json({ error: 'Invalid pairing request' }, { status: 400 });
	return Response.json(await getPairingSessions().poll(body.sessionId));
};
