import type { RequestHandler } from './$types';
import { getSyncAuth } from '#lib/server/syncAuth.js';
import { readJsonBody } from '#lib/server/request.js';
import { clientAddress, getPublicApiLimiter, rateLimitResponse } from '#lib/server/rateLimit.js';
import {
	exchangeReminderHistory,
	validReminderPacket,
	ReminderHistoryQuotaError
} from '#lib/server/reminderHistoryRelay.js';
import { REMINDER_BATCH_SIZE } from '#lib/reminderChannel.js';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const limiter = getPublicApiLimiter();
	const address = await limiter.check(`reminders-ip:${clientAddress(getClientAddress)}`, {
		capacity: 240,
		refillWindowMs: 60_000
	});
	if (!address.allowed) return rateLimitResponse(address);
	const accountId = await getSyncAuth().authenticateSyncRequest(request);
	if (!accountId) return Response.json({ error: 'Invalid sync session' }, { status: 401 });
	const account = await limiter.check(`reminders-account:${accountId}`, {
		capacity: 120,
		refillWindowMs: 60_000
	});
	if (!account.allowed) return rateLimitResponse(account);
	let body: { cursor?: unknown; notes?: unknown } | null;
	try {
		body = (await readJsonBody(request, 65_536)) as typeof body;
	} catch {
		return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	if (
		!body ||
		!Number.isSafeInteger(body.cursor) ||
		Number(body.cursor) < 0 ||
		!Array.isArray(body.notes) ||
		body.notes.length > REMINDER_BATCH_SIZE ||
		!body.notes.every(validReminderPacket) ||
		new Set(body.notes.map((row) => row.note)).size !== body.notes.length
	)
		return Response.json({ error: 'Invalid reminder receipts' }, { status: 400 });
	try {
		const page = await exchangeReminderHistory(accountId, Number(body.cursor), body.notes);
		return Response.json(page, {
			headers: { 'cache-control': 'no-store' }
		});
	} catch (error) {
		return Response.json(
			{
				error:
					error instanceof ReminderHistoryQuotaError
						? 'Reminder history storage is full'
						: 'Reminder history is temporarily unavailable'
			},
			{ status: error instanceof ReminderHistoryQuotaError ? 507 : 503 }
		);
	}
};
