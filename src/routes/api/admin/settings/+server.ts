import type { RequestHandler } from './$types';
import { requireAdmin } from '#lib/server/adminAuth.js';
import { readJsonBody } from '#lib/server/request.js';
import {
	getRuntimeSettingsState,
	parseRuntimeSettingsPatch,
	updateRuntimeSettings
} from '#lib/server/runtimeSettings.js';

const MAX_REQUEST_BYTES = 8_192;
const NO_STORE = { headers: { 'cache-control': 'no-store' } };

export const GET: RequestHandler = async ({ request, getClientAddress }) => {
	const rejected = await requireAdmin(request, getClientAddress);
	if (rejected) return rejected;
	return Response.json(await getRuntimeSettingsState(), NO_STORE);
};

export const PATCH: RequestHandler = async ({ request, getClientAddress }) => {
	const rejected = await requireAdmin(request, getClientAddress);
	if (rejected) return rejected;
	let body: unknown;
	try {
		body = await readJsonBody(request, MAX_REQUEST_BYTES);
	} catch {
		return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	try {
		return Response.json(await updateRuntimeSettings(parseRuntimeSettingsPatch(body)), NO_STORE);
	} catch (error) {
		if (error instanceof RangeError)
			return Response.json({ error: error.message }, { status: 400 });
		throw error;
	}
};
