import type { RequestHandler } from './$types';
import { requireAdmin } from '#lib/server/adminAuth.js';
import { getOperatorSnapshot } from '#lib/server/operatorMonitor.js';

export const GET: RequestHandler = async ({ request, getClientAddress }) => {
	const rejected = await requireAdmin(request, getClientAddress);
	if (rejected) return rejected;
	return Response.json(await getOperatorSnapshot(), {
		headers: { 'cache-control': 'no-store' }
	});
};
