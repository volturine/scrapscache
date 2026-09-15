import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/adminAuth';
import { readJsonBody } from '$lib/server/request';
import {
	getRuntimeSettingsState,
	parseRuntimeSettingsPatch,
	updateRuntimeSettings
} from '$lib/server/runtimeSettings';

const MAX_REQUEST_BYTES = 8_192;
const NO_STORE = { headers: { 'cache-control': 'no-store' } };

export const GET: RequestHandler = async ({ request, getClientAddress }) => {
	const rejected = await requireAdmin(request, getClientAddress);
	if (rejected) return rejected;
	return json(await getRuntimeSettingsState(), NO_STORE);
};

export const PATCH: RequestHandler = async ({ request, getClientAddress }) => {
	const rejected = await requireAdmin(request, getClientAddress);
	if (rejected) return rejected;
	let body: unknown;
	try {
		body = await readJsonBody(request, MAX_REQUEST_BYTES);
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	try {
		return json(await updateRuntimeSettings(parseRuntimeSettingsPatch(body)), NO_STORE);
	} catch (error) {
		if (error instanceof RangeError) return json({ error: error.message }, { status: 400 });
		throw error;
	}
};
