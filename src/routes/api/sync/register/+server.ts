import type { RequestHandler } from './$types';
import { getSyncStore } from '#lib/server/syncStore.js';
import { verifySyncRegistration } from '#lib/server/syncAuth.js';
import { readJsonBody } from '#lib/server/request.js';
import { verifyTurnstile } from '#lib/server/turnstile.js';
import {
	chargeRegisterGlobalLimit,
	checkRegisterLimit,
	clientAddress,
	rateLimitResponse
} from '#lib/server/rateLimit.js';
import { retiredKeyResponse } from '#lib/server/retiredKey.js';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const limited = await checkRegisterLimit(getClientAddress);
	if (!limited.allowed) return rateLimitResponse(limited);
	let body: {
		accountId?: unknown;
		authPublicKey?: unknown;
		signature?: unknown;
		turnstileToken?: unknown;
	};
	try {
		body = (await readJsonBody(request, 16_384)) as typeof body;
	} catch {
		return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	if (typeof body.accountId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(body.accountId)) {
		return Response.json({ error: 'Invalid account identity' }, { status: 400 });
	}
	if (
		typeof body.authPublicKey !== 'string' ||
		typeof body.signature !== 'string' ||
		!verifySyncRegistration(body.accountId, body.authPublicKey, body.signature)
	) {
		return Response.json({ error: 'Invalid account credential' }, { status: 400 });
	}
	// Checked after the local signature so malformed requests never spend a siteverify call.
	const human = await verifyTurnstile(
		body.turnstileToken,
		'register',
		clientAddress(getClientAddress)
	);
	if (human === 'misconfigured') {
		console.error('[sync] register: Turnstile configuration is incomplete');
		return Response.json({ error: 'Human verification is unavailable' }, { status: 503 });
	}
	if (human === 'rejected')
		return Response.json({ error: 'Human verification failed. Try again.' }, { status: 403 });
	// Only a request that proved itself spends everyone's allowance.
	const everyone = await chargeRegisterGlobalLimit();
	if (!everyone.allowed) return rateLimitResponse(everyone);
	try {
		const store = getSyncStore();
		const created = await store.createAccount(body.accountId, body.authPublicKey);
		if (!created) {
			if (await store.isAccountRetired(body.accountId)) return retiredKeyResponse();
			return Response.json(
				{ error: 'This sync account already exists on this device.' },
				{ status: 409 }
			);
		}
		return Response.json({ accountId: body.accountId });
	} catch (err) {
		console.error('[sync] register failed:', err);
		return Response.json({ error: 'Sync storage is temporarily unavailable' }, { status: 503 });
	}
};
