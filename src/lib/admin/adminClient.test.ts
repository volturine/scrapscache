import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminClient, AdminUnauthorized, formatAgo, formatBytes } from './adminClient.svelte';

const requests: Array<{ url: string; init: RequestInit }> = [];

function respond(status: number, body: unknown, json = true) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			requests.push({ url, init });
			return new Response(json ? JSON.stringify(body) : String(body), { status });
		})
	);
}

beforeEach(() => {
	sessionStorage.clear();
	requests.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe('holding the admin token', () => {
	it('keeps it for this tab only', () => {
		const client = new AdminClient();
		client.remember('  secret  ');

		expect(client.token).toBe('secret');
		expect(sessionStorage.getItem('scrapscache-admin-token')).toBe('secret');
		expect(localStorage.getItem('scrapscache-admin-token')).toBeNull();
	});

	it('picks it back up after a reload in the same tab', () => {
		sessionStorage.setItem('scrapscache-admin-token', 'secret');
		expect(new AdminClient().signedIn).toBe(true);
	});

	it('forgets it completely on sign-out', () => {
		const client = new AdminClient();
		client.remember('secret');
		client.forget();

		expect(client.signedIn).toBe(false);
		expect(sessionStorage.getItem('scrapscache-admin-token')).toBeNull();
	});

	it('sends it as a bearer header and never in the URL', async () => {
		respond(200, { total: 0, accounts: [] });
		const client = new AdminClient();
		client.remember('secret');

		await client.accounts('abc');

		expect(new Headers(requests[0].init.headers).get('authorization')).toBe('Bearer secret');
		expect(requests[0].url).not.toContain('secret');
	});
});

describe('telling a rejected token from an ordinary not-found', () => {
	it('treats the guard’s bare 404 as not authorised', async () => {
		respond(404, 'Not found\n', false);
		const client = new AdminClient();
		client.remember('wrong');

		await expect(client.status()).rejects.toBeInstanceOf(AdminUnauthorized);
	});

	it('does not sign you out when a gate you removed is already gone', async () => {
		respond(404, { error: 'No such flag' });
		const client = new AdminClient();
		client.remember('secret');

		const failure = await client.deleteFlag('canvas-beta').catch((error: unknown) => error);

		expect(failure).not.toBeInstanceOf(AdminUnauthorized);
		expect((failure as Error).message).toBe('No such flag');
	});

	it('reports an unknown account as unknown, not as a bad token', async () => {
		respond(404, { error: 'Sync account not found' });
		const client = new AdminClient();
		client.remember('secret');

		const failure = await client.account('account-abcdefghij').catch((error: unknown) => error);

		expect(failure).not.toBeInstanceOf(AdminUnauthorized);
	});

	it('surfaces a validation message from the API as written', async () => {
		respond(400, { error: 'syncPerMinute must be a positive integer or null' });
		const client = new AdminClient();
		client.remember('secret');

		await expect(
			client.updateAccount({ accountId: 'account-abcdefghij', syncPerMinute: 0 })
		).rejects.toThrow('syncPerMinute must be a positive integer or null');
	});
});

describe('sending changes', () => {
	it('sends null to restore a default, not zero', async () => {
		respond(200, {});
		const client = new AdminClient();
		client.remember('secret');

		await client.updateAccount({ accountId: 'account-abcdefghij', maxBytes: null });

		expect(requests[0].init.method).toBe('PATCH');
		expect(JSON.parse(String(requests[0].init.body))).toEqual({
			accountId: 'account-abcdefghij',
			maxBytes: null
		});
	});
});

describe('formatting', () => {
	it('scales bytes into something readable', () => {
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(4_096)).toBe('4 KB');
		expect(formatBytes(2_500_000)).toBe('2.5 MB');
		expect(formatBytes(3_000_000_000)).toBe('3.00 GB');
	});

	it('says never for an account that has never been seen', () => {
		expect(formatAgo(0)).toBe('never');
		expect(formatAgo(1_000_000 - 30_000, 1_000_000)).toBe('30s ago');
		expect(formatAgo(1_000_000 - 3 * 86_400_000, 1_000_000)).toBe('3d ago');
	});
});
