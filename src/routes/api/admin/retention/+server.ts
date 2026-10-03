import type { RequestHandler } from './$types';
import { requireAdmin } from '#lib/server/adminAuth.js';
import { runRetentionSweep } from '#lib/server/retentionSweep.js';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const rejected = await requireAdmin(request, getClientAddress);
	if (rejected) return rejected;
	try {
		return Response.json(await runRetentionSweep({ force: true }), {
			headers: { 'cache-control': 'no-store' }
		});
	} catch {
		return Response.json({ error: 'Retention sweep failed' }, { status: 503 });
	}
};
