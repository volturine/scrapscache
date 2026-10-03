import type { RequestHandler } from './$types';
import { getVapidKeys } from '#lib/server/webPush.js';

/** Public VAPID key for PushManager.subscribe. The private key never leaves the server. */
export const GET: RequestHandler = async () => {
	try {
		return Response.json({ publicKey: (await getVapidKeys()).publicKey });
	} catch {
		return Response.json({ error: 'Push is temporarily unavailable' }, { status: 503 });
	}
};
