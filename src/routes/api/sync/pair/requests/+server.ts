import type { RequestHandler } from './$types';
export const POST: RequestHandler = async () =>
	Response.json({ error: 'Use the simultaneous device rendezvous flow' }, { status: 410 });
