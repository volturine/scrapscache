import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/adminAuth';
import { readJsonBody } from '$lib/server/request';
import { getSyncStore } from '$lib/server/syncStore';
import { ACCOUNT_ID_RE } from '$lib/server/pushWakes';

const MAX_REQUEST_BYTES = 8_192;
const FLAG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

type Patch = {
	accountId?: unknown;
	maxBytes?: unknown;
	syncPerMinute?: unknown;
	flags?: unknown;
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

	const accountId = url.searchParams.get('accountId');
	if (accountId) {
		if (!ACCOUNT_ID_RE.test(accountId)) return json({ error: 'Invalid account' }, { status: 400 });
		const page = await store.listAccounts({ search: accountId, limit: 1 });
		const account = page.accounts.find((entry) => entry.accountId === accountId);
		if (!account) return json({ error: 'Sync account not found' }, { status: 404 });
		return json(
			{ ...account, flags: await store.accountFeatureFlags(accountId) },
			{ headers: { 'cache-control': 'no-store' } }
		);
	}

	const limit = Number(url.searchParams.get('limit'));
	const offset = Number(url.searchParams.get('offset'));
	return json(
		await store.listAccounts({
			limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
			offset: Number.isFinite(offset) && offset > 0 ? offset : undefined,
			search: url.searchParams.get('search') ?? undefined
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

	const flags = body.flags;
	if (flags !== undefined) {
		if (!flags || typeof flags !== 'object' || Array.isArray(flags)) {
			return json({ error: 'flags must be an object' }, { status: 400 });
		}
		for (const [flag, enabled] of Object.entries(flags)) {
			if (!FLAG_RE.test(flag) || !(enabled === null || typeof enabled === 'boolean')) {
				return json({ error: `Invalid flag setting for ${flag}` }, { status: 400 });
			}
		}
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

		for (const [flag, enabled] of Object.entries((flags ?? {}) as Record<string, boolean | null>)) {
			if (enabled === null) await store.clearAccountFeatureFlag(accountId, flag);
			else await store.setAccountFeatureFlag(accountId, flag, enabled);
		}
	} catch (error) {
		if (error instanceof RangeError) return json({ error: error.message }, { status: 400 });
		throw error;
	}

	const page = await store.listAccounts({ search: accountId, limit: 1 });
	const account = page.accounts.find((entry) => entry.accountId === accountId);
	return json(
		{ ...account, flags: await store.accountFeatureFlags(accountId) },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
