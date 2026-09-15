import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/adminAuth';
import { runRetentionSweep } from '$lib/server/retentionSweep';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const rejected = await requireAdmin(request, getClientAddress);
	if (rejected) return rejected;
	try {
		return json(await runRetentionSweep({ force: true }), {
			headers: { 'cache-control': 'no-store' }
		});
	} catch {
		return json({ error: 'Retention sweep failed' }, { status: 503 });
	}
};
