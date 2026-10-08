import type { RequestHandler } from './$types';
import { getSyncStore } from '#lib/server/syncStore.js';
import { getSyncAuth } from '#lib/server/syncAuth.js';
import { readJsonBody } from '#lib/server/request.js';
import { clientAddress, getPublicApiLimiter, rateLimitResponse } from '#lib/server/rateLimit.js';
import { recordSqliteError } from '#lib/server/metrics.js';
import { armWakeTimer } from '#lib/server/wakeTimer.js';
import {
	DEVICE_ID_RE,
	isPublicEndpoint,
	isPushSubscription,
	parseReminderWakes
} from '#lib/server/pushWakes.js';

const MAX_REQUEST_BYTES = 128_000;

function checkAddressLimit(getClientAddress: () => string) {
	return getPublicApiLimiter().check(`push-ip:${clientAddress(getClientAddress)}`, {
		capacity: 40,
		refillWindowMs: 60_000
	});
}

/**
 * Deliver the account's due wakes now; delivery then sets the timer for its next
 * one. Its wakes or browsers just changed, so any timer it had may be wrong.
 */
async function scheduleDelivery(accountId: string): Promise<void> {
	await armWakeTimer(accountId, Date.now()).catch((error: unknown) =>
		console.error(
			JSON.stringify({
				level: 'error',
				event: 'wake_timer_arm_failed',
				message: error instanceof Error ? error.message : 'Could not arm the wake timer'
			})
		)
	);
}

/** Fetch the current reminder wakes and revision for this account. */
export const GET: RequestHandler = async ({ request, getClientAddress }) => {
	const addressLimit = await checkAddressLimit(getClientAddress);
	if (!addressLimit.allowed) return rateLimitResponse(addressLimit);
	const accountId = await getSyncAuth().authenticateSyncRequest(request);
	if (!accountId) return Response.json({ error: 'Invalid sync session' }, { status: 401 });
	try {
		const result = await getSyncStore().getReminderWakes(accountId);
		return Response.json(result);
	} catch (error) {
		recordSqliteError(error);
		return Response.json(
			{ error: 'Reminder scheduling is temporarily unavailable' },
			{ status: 503 }
		);
	}
};

/** Register or refresh this device without changing the account wake snapshot. */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const addressLimit = await checkAddressLimit(getClientAddress);
	if (!addressLimit.allowed) return rateLimitResponse(addressLimit);
	let body: { deviceId?: unknown; subscription?: unknown };
	try {
		body = (await readJsonBody(request, MAX_REQUEST_BYTES)) as typeof body;
	} catch {
		return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	if (typeof body.deviceId !== 'string' || !DEVICE_ID_RE.test(body.deviceId)) {
		return Response.json({ error: 'A device id is required' }, { status: 400 });
	}
	if (!isPushSubscription(body.subscription)) {
		return Response.json({ error: 'A push subscription is required' }, { status: 400 });
	}
	const accountId = await getSyncAuth().authenticateSyncRequest(request);
	if (!accountId) return Response.json({ error: 'Invalid sync session' }, { status: 401 });
	if (!(await isPublicEndpoint(body.subscription.endpoint))) {
		return Response.json(
			{ error: 'The push endpoint must be on a known push service' },
			{ status: 400 }
		);
	}
	const deviceLimit = await getPublicApiLimiter().check(`push-device:${body.deviceId}`, {
		capacity: 20,
		refillWindowMs: 60_000
	});
	if (!deviceLimit.allowed) return rateLimitResponse(deviceLimit);
	try {
		await getSyncStore().savePushDevice({
			accountId,
			deviceId: body.deviceId,
			endpoint: body.subscription.endpoint,
			p256dh: body.subscription.keys.p256dh,
			auth: body.subscription.keys.auth
		});
		// A browser that registers after a wake came due still gets it.
		await scheduleDelivery(accountId);
		return Response.json({ ok: true });
	} catch (error) {
		recordSqliteError(error);
		return Response.json(
			{ error: 'Push registration is temporarily unavailable' },
			{ status: 503 }
		);
	}
};

/** Replace the account-wide opaque wake snapshot after client sync reconciliation. */
export const PUT: RequestHandler = async ({ request, getClientAddress }) => {
	const addressLimit = await checkAddressLimit(getClientAddress);
	if (!addressLimit.allowed) return rateLimitResponse(addressLimit);
	let body: { wakes?: unknown; revision?: unknown };
	try {
		body = (await readJsonBody(request, MAX_REQUEST_BYTES)) as typeof body;
	} catch {
		return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const accountId = await getSyncAuth().authenticateSyncRequest(request);
	if (!accountId) return Response.json({ error: 'Invalid sync session' }, { status: 401 });
	const wakes = parseReminderWakes(body.wakes, Date.now());
	if (!wakes) return Response.json({ error: 'Invalid reminder wakes' }, { status: 400 });
	if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) {
		return Response.json({ error: 'A sync revision is required' }, { status: 400 });
	}
	try {
		const accepted = await getSyncStore().replaceReminderWakes(
			accountId,
			wakes,
			Number(body.revision)
		);
		if (!accepted) return Response.json({ error: 'Stale reminder snapshot' }, { status: 409 });
		await scheduleDelivery(accountId);
		return Response.json({ ok: true, wakes: wakes.length });
	} catch (error) {
		recordSqliteError(error);
		return Response.json(
			{ error: 'Reminder scheduling is temporarily unavailable' },
			{ status: 503 }
		);
	}
};

/** Stop deliveries for this browser while retaining other devices and account wakes. */
export const DELETE: RequestHandler = async ({ request, getClientAddress }) => {
	const addressLimit = await checkAddressLimit(getClientAddress);
	if (!addressLimit.allowed) return rateLimitResponse(addressLimit);
	let body: { deviceId?: unknown };
	try {
		body = (await readJsonBody(request, MAX_REQUEST_BYTES)) as typeof body;
	} catch {
		return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	if (typeof body.deviceId !== 'string' || !DEVICE_ID_RE.test(body.deviceId)) {
		return Response.json({ error: 'A device id is required' }, { status: 400 });
	}
	const accountId = await getSyncAuth().authenticateSyncRequest(request);
	if (!accountId) return Response.json({ error: 'Invalid sync session' }, { status: 401 });
	try {
		await getSyncStore().deletePushDevice(accountId, body.deviceId);
		return new Response(null, { status: 204 });
	} catch (error) {
		recordSqliteError(error);
		return Response.json(
			{ error: 'Push registration is temporarily unavailable' },
			{ status: 503 }
		);
	}
};
