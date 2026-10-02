import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { SCRAPSCACHE_TICK_SECRET } from '$app/env/private';
import { isAdminAuthorized, unauthorizedAdminResponse } from '#lib/server/adminAuth.js';
import { clientAddress, getPublicApiLimiter, rateLimitResponse } from '#lib/server/rateLimit.js';
import { getDb } from '#lib/server/db.js';
import { dispatchDueWakes } from '#lib/server/wakeDispatch.js';
import { beginWakeDelivery, rescheduleWakeTimer } from '#lib/server/wakeTimer.js';
import { ACCOUNT_ID_RE } from '#lib/server/pushWakes.js';

/**
 * Deliver an account's due reminder wakes and set its next delivery. On Workers,
 * the app's wake-queue consumer calls this for each account whose reminder alarm
 * fired.
 *
 * Callers holding the tick secret are never throttled: every account's alarm
 * lands here, many at the same minute. The secret is 256 random bits, so only
 * failed attempts are throttled, per address.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const secret = SCRAPSCACHE_TICK_SECRET;
	if (!secret || !isAdminAuthorized(request, secret)) {
		const limited = await getPublicApiLimiter().check(
			`wakes-denied:${clientAddress(getClientAddress)}`,
			{ capacity: 30, refillWindowMs: 60_000 }
		);
		return limited.allowed ? unauthorizedAdminResponse() : rateLimitResponse(limited);
	}
	const body = (await request.json().catch(() => ({}))) as { accountId?: unknown };
	if (typeof body.accountId !== 'string' || !ACCOUNT_ID_RE.test(body.accountId)) {
		return json({ error: 'An account id is required' }, { status: 400 });
	}
	try {
		await getDb().ready;
		const generation = await beginWakeDelivery(body.accountId);
		const result = await dispatchDueWakes({ accountId: body.accountId });
		await rescheduleWakeTimer(body.accountId, result.next, generation);
		return json(result, { headers: { 'cache-control': 'no-store' } });
	} catch (error) {
		console.error(
			JSON.stringify({
				level: 'error',
				event: 'wake_dispatch_failed',
				message: error instanceof Error ? error.message : 'Wake dispatch failed'
			})
		);
		return json({ error: 'Wake dispatch failed' }, { status: 503 });
	}
};
