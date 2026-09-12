import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/adminAuth';
import { readJsonBody } from '$lib/server/request';
import { getSyncStore } from '$lib/server/syncStore';

const MAX_REQUEST_BYTES = 4_096;
const FLAG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_DESCRIPTION = 200;

/** The gates that exist, and what an account gets without an opinion of its own. */
export const GET: RequestHandler = async ({ request, getClientAddress }) => {
	const rejected = await requireAdmin(request, getClientAddress);
	if (rejected) return rejected;
	return json(
		{ flags: await getSyncStore().listFeatureFlags() },
		{ headers: { 'cache-control': 'no-store' } }
	);
};

export const PUT: RequestHandler = async ({ request, getClientAddress }) => {
	const rejected = await requireAdmin(request, getClientAddress);
	if (rejected) return rejected;
	let body: { flag?: unknown; defaultEnabled?: unknown; description?: unknown };
	try {
		body = (await readJsonBody(request, MAX_REQUEST_BYTES)) as typeof body;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	if (typeof body.flag !== 'string' || !FLAG_RE.test(body.flag)) {
		return json(
			{ error: 'A flag is lowercase letters, digits and dashes, up to 64 characters' },
			{ status: 400 }
		);
	}
	if (typeof body.defaultEnabled !== 'boolean') {
		return json({ error: 'defaultEnabled must be true or false' }, { status: 400 });
	}
	const description = typeof body.description === 'string' ? body.description : '';
	if (description.length > MAX_DESCRIPTION) {
		return json({ error: 'description is too long' }, { status: 400 });
	}
	await getSyncStore().upsertFeatureFlag(body.flag, body.defaultEnabled, description);
	return json(
		{ flags: await getSyncStore().listFeatureFlags() },
		{ headers: { 'cache-control': 'no-store' } }
	);
};

/** Ends a rollout. Takes every per-account opinion about the gate with it, so a
 * finished experiment leaves nothing behind to puzzle over later. */
export const DELETE: RequestHandler = async ({ request, getClientAddress }) => {
	const rejected = await requireAdmin(request, getClientAddress);
	if (rejected) return rejected;
	let body: { flag?: unknown };
	try {
		body = (await readJsonBody(request, MAX_REQUEST_BYTES)) as typeof body;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	if (typeof body.flag !== 'string' || !FLAG_RE.test(body.flag)) {
		return json({ error: 'Invalid flag' }, { status: 400 });
	}
	if (!(await getSyncStore().deleteFeatureFlag(body.flag))) {
		return json({ error: 'No such flag' }, { status: 404 });
	}
	return json(
		{ flags: await getSyncStore().listFeatureFlags() },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
