import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/adminAuth';
import { getOperatorSnapshot } from '$lib/server/operatorMonitor';

export const GET: RequestHandler = async ({ request, getClientAddress }) => {
	const rejected = await requireAdmin(request, getClientAddress);
	if (rejected) return rejected;
	return json(await getOperatorSnapshot(), {
		headers: { 'cache-control': 'no-store' }
	});
};
