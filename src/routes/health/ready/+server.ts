import type { RequestHandler } from './$types';
import { getSyncStore } from '#lib/server/syncStore.js';

export const GET: RequestHandler = async () => {
	const ready = await getSyncStore().isReady();
	return Response.json(
		{ ready },
		{ status: ready ? 200 : 503, headers: { 'cache-control': 'no-store' } }
	);
};
