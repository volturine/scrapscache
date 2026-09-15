import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/adminAuth';
import { readJsonBody } from '$lib/server/request';
import { getSyncStore } from '$lib/server/syncStore';
import { ACCOUNT_ID_RE } from '$lib/server/pushWakes';
import { getRuntimeSettings } from '$lib/server/runtimeSettings';

const MAX_REQUEST_BYTES = 8_192;

type Patch = {
	accountId?: unknown;
	maxBytes?: unknown;
	syncPerMinute?: unknown;
};

/** A positive limit, or null to hand the account back to the shared default. */
function limitValue(value: unknown): number | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

/**
 * One account, or a page of them. Storage figures are the same ones the quota is
 * charged against, so what an operator sees is what the relay enforces.
 */
export const GET: RequestHandler = async ({ request, url, getClientAddress }) => {
	const rejected = await requireAdmin(request, getClientAddress);
	if (rejected) return rejected;
	const store = getSyncStore();
	const settings = await getRuntimeSettings();
	const defaults = {
		defaultMaxAccountBytes: settings.maxAccountBytes,
		defaultSyncPerMinute: settings.syncPerMinute
	};

	const accountId = url.searchParams.get('accountId');
	if (accountId) {
		if (!ACCOUNT_ID_RE.test(accountId)) return json({ error: 'Invalid account' }, { status: 400 });
		const [account] = (await store.listAccounts({ accountId, ...defaults })).accounts;
		if (!account) return json({ error: 'Sync account not found' }, { status: 404 });
		return json(account, { headers: { 'cache-control': 'no-store' } });
	}

	const limit = Number(url.searchParams.get('limit'));
	const offset = Number(url.searchParams.get('offset'));
	return json(
		await store.listAccounts({
			limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
			offset: Number.isFinite(offset) && offset > 0 ? offset : undefined,
			search: url.searchParams.get('search') ?? undefined,
			...defaults
		}),
		{ headers: { 'cache-control': 'no-store' } }
	);
};

/**
 * Change what one account is allowed. Every field is optional; null restores the
 * shared default rather than setting zero, so there is no value an operator can
 * type that silently disables an account.
 */
export const PATCH: RequestHandler = async ({ request, getClientAddress }) => {
	const rejected = await requireAdmin(request, getClientAddress);
	if (rejected) return rejected;
	const settings = await getRuntimeSettings();
	const defaults = {
		defaultMaxAccountBytes: settings.maxAccountBytes,
		defaultSyncPerMinute: settings.syncPerMinute
	};

	let body: Patch;
	try {
		body = (await readJsonBody(request, MAX_REQUEST_BYTES)) as Patch;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	if (typeof body.accountId !== 'string' || !ACCOUNT_ID_RE.test(body.accountId)) {
		return json({ error: 'Invalid account' }, { status: 400 });
	}
	const accountId = body.accountId;

	const maxBytes = limitValue(body.maxBytes);
	if (body.maxBytes !== undefined && maxBytes === undefined) {
		return json({ error: 'maxBytes must be a positive integer or null' }, { status: 400 });
	}
	const syncPerMinute = limitValue(body.syncPerMinute);
	if (body.syncPerMinute !== undefined && syncPerMinute === undefined) {
		return json({ error: 'syncPerMinute must be a positive integer or null' }, { status: 400 });
	}

	const store = getSyncStore();
	// Existence is checked once here so a request naming an unknown account fails
	// as a whole, rather than partly applying and reporting success.
	if (!(await store.getAuthCredential(accountId))) {
		return json({ error: 'Sync account not found' }, { status: 404 });
	}

	try {
		if (maxBytes === null) await store.clearAccountByteQuota(accountId);
		else if (maxBytes !== undefined) await store.setAccountByteQuota(accountId, maxBytes);

		if (syncPerMinute === null) await store.clearAccountRateLimit(accountId);
		else if (syncPerMinute !== undefined) await store.setAccountRateLimit(accountId, syncPerMinute);
	} catch (error) {
		if (error instanceof RangeError) return json({ error: error.message }, { status: 400 });
		throw error;
	}

	const [account] = (await store.listAccounts({ accountId, ...defaults })).accounts;
	return json(account, { headers: { 'cache-control': 'no-store' } });
};
