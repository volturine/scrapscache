import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Client } from '@libsql/client/node';
import { applyMigrations, testD1, testR2 } from './testBindings';

const bindings = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('./env', () => ({ cloudflareBindings: () => bindings.value }));

import { SyncStore } from './syncStore';
import { DEFAULT_SYNC_PER_MINUTE } from '$lib/server/operatorConfig';

const MAX_BYTES = 100_000_000;

let client: Client;
let store: SyncStore;

async function addAccount(accountId: string, bytes = 0, envelopes = 0): Promise<void> {
	await client.execute({
		sql: `INSERT INTO accounts(account_id, credential_hash, envelope_count, ciphertext_bytes,
			updated_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)`,
		args: [accountId, 'public-key', envelopes, bytes, 0, 0]
	});
}

beforeEach(async () => {
	const d1 = testD1();
	const r2 = testR2();
	client = d1.client;
	await applyMigrations(client);
	await client.executeMultiple(readFileSync('cf/migrations/0002_account_controls.sql', 'utf8'));
	bindings.value = {
		SCRAPSCACHE_DB: d1.db,
		SCRAPSCACHE_ENVELOPES: r2.bucket,
		SCRAPSCACHE_SYNC_MAX_ACCOUNT_BYTES: String(MAX_BYTES)
	};
	store = new SyncStore();
});

describe('listing accounts for the operator view', () => {
	it('opens on whatever is consuming the most', async () => {
		await addAccount('account-small', 100, 1);
		await addAccount('account-large', 9_000, 3);

		const page = await store.listAccounts();

		expect(page.total).toBe(2);
		expect(page.accounts.map(({ accountId }) => accountId)).toEqual([
			'account-large',
			'account-small'
		]);
	});

	it('reports the shared defaults until something is overridden', async () => {
		await addAccount('account-plain', 1_000, 2);

		const [account] = (await store.listAccounts()).accounts;

		expect(account.maxBytes).toBe(MAX_BYTES);
		expect(account.maxBytesOverridden).toBe(false);
		expect(account.syncPerMinute).toBe(DEFAULT_SYNC_PER_MINUTE);
		expect(account.syncPerMinuteOverridden).toBe(false);
		// Storage is ciphertext plus the per-record overhead quota is charged on.
		expect(account.storageBytes).toBe(1_000 + 2 * 512);
	});

	it('marks an override as one, so the default is never mistaken for a decision', async () => {
		await addAccount('account-tuned');
		await store.setAccountByteQuota('account-tuned', 5_000);
		await store.setAccountRateLimit('account-tuned', 240);

		const [account] = (await store.listAccounts()).accounts;

		expect(account).toMatchObject({
			maxBytes: 5_000,
			maxBytesOverridden: true,
			syncPerMinute: 240,
			syncPerMinuteOverridden: true
		});
	});

	it('finds one account by the start of its id', async () => {
		await addAccount('account-aaa');
		await addAccount('account-bbb');

		const page = await store.listAccounts({ search: 'account-b' });

		expect(page.total).toBe(1);
		expect(page.accounts[0].accountId).toBe('account-bbb');
	});

	it('pages, and clamps a caller asking for everything at once', async () => {
		for (let index = 0; index < 5; index++) await addAccount(`account-${index}`, index * 10);

		expect((await store.listAccounts({ limit: 2 })).accounts).toHaveLength(2);
		expect((await store.listAccounts({ limit: 2, offset: 4 })).accounts).toHaveLength(1);
		expect((await store.listAccounts({ limit: 10_000 })).total).toBe(5);
	});
});

describe('per-account request limits', () => {
	it('round-trips an override and falls back to the default once cleared', async () => {
		await addAccount('account-tuned');

		expect(await store.accountRateLimit('account-tuned')).toBeNull();
		expect(await store.setAccountRateLimit('account-tuned', 5)).toBe(true);
		expect(await store.accountRateLimit('account-tuned')).toBe(5);
		expect(await store.clearAccountRateLimit('account-tuned')).toBe(true);
		expect(await store.accountRateLimit('account-tuned')).toBeNull();
	});

	it('refuses an account that does not exist rather than creating a dangling row', async () => {
		expect(await store.setAccountRateLimit('account-ghost', 5)).toBe(false);
		expect(await store.clearAccountRateLimit('account-ghost')).toBe(false);
	});

	it('rejects a limit that would stop the account working', async () => {
		await addAccount('account-tuned');
		await expect(store.setAccountRateLimit('account-tuned', 0)).rejects.toThrow(RangeError);
		await expect(store.setAccountRateLimit('account-tuned', -1)).rejects.toThrow(RangeError);
	});
});

describe('feature gates', () => {
	it('reports nothing for an account when no gate has been declared', async () => {
		await addAccount('account-one');
		expect(await store.accountFeatureFlags('account-one')).toEqual({});
	});

	it('gives an account the default until it has an opinion of its own', async () => {
		await addAccount('account-one');
		await store.upsertFeatureFlag('canvas-beta', false, 'Unreleased canvas');

		expect(await store.accountFeatureFlags('account-one')).toEqual({ 'canvas-beta': false });

		await store.setAccountFeatureFlag('account-one', 'canvas-beta', true);
		expect(await store.accountFeatureFlags('account-one')).toEqual({ 'canvas-beta': true });
	});

	it('lets one account opt out of something already on by default', async () => {
		await addAccount('account-one');
		await addAccount('account-two');
		await store.upsertFeatureFlag('canvas-beta', true);

		await store.setAccountFeatureFlag('account-two', 'canvas-beta', false);

		expect(await store.accountFeatureFlags('account-one')).toEqual({ 'canvas-beta': true });
		expect(await store.accountFeatureFlags('account-two')).toEqual({ 'canvas-beta': false });
	});

	it('returns to the default when an account opinion is cleared', async () => {
		await addAccount('account-one');
		await store.upsertFeatureFlag('canvas-beta', true);
		await store.setAccountFeatureFlag('account-one', 'canvas-beta', false);

		await store.clearAccountFeatureFlag('account-one', 'canvas-beta');

		expect(await store.accountFeatureFlags('account-one')).toEqual({ 'canvas-beta': true });
	});

	it('takes every per-account opinion with the gate when a rollout finishes', async () => {
		await addAccount('account-one');
		await store.upsertFeatureFlag('canvas-beta', false);
		await store.setAccountFeatureFlag('account-one', 'canvas-beta', true);

		expect(await store.deleteFeatureFlag('canvas-beta')).toBe(true);

		expect(await store.listFeatureFlags()).toEqual([]);
		expect(await store.accountFeatureFlags('account-one')).toEqual({});
		const leftovers = await client.execute('SELECT COUNT(*) AS n FROM account_feature_flags');
		expect(Number(leftovers.rows[0].n)).toBe(0);
	});

	it('updates a gate in place rather than duplicating it', async () => {
		await store.upsertFeatureFlag('canvas-beta', false, 'first');
		await store.upsertFeatureFlag('canvas-beta', true, 'second');

		expect(await store.listFeatureFlags()).toEqual([
			{ flag: 'canvas-beta', defaultEnabled: true, description: 'second' }
		]);
	});

	it('will not pin a gate to an account that does not exist', async () => {
		await store.upsertFeatureFlag('canvas-beta', false);
		expect(await store.setAccountFeatureFlag('account-ghost', 'canvas-beta', true)).toBe(false);
	});
});
