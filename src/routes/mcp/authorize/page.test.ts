import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncIdentity, identityFromSyncKey } from '#lib/syncPairing.js';
import { syncStore } from '#lib/stores/sync.svelte.js';
import { bytesToBase64Url } from '#lib/mcpHandshake.js';
import { x25519 } from '@noble/curves/ed25519.js';
import AuthorizePage from './+page.svelte';

const AUTHORIZE_URL =
	'https://scrapscache.com/mcp/authorize?session_id=test-session&mcp_public_key=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH&mcp_callback=https%3A%2F%2Fscrapscache-mcp.kripso.workers.dev%2Foauth%2Fcallback&client_name=ChatGPT';

const pageState = vi.hoisted(() => ({ url: new URL('https://scrapscache.com/mcp/authorize') }));
vi.mock('$app/state', () => ({ page: pageState }));

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

function mockRelay(unavailableAccountId?: string) {
	const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const path = new URL(String(input), 'http://localhost').pathname;
		if (path.endsWith('/auth/challenge')) {
			const body = JSON.parse(String(init?.body)) as { accountId: string };
			if (body.accountId === unavailableAccountId)
				return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
			return new Response(JSON.stringify({ challengeId: 'challenge', challenge: 'value' }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		return new Response(JSON.stringify({ accessToken: 'token', expiresAt: Date.now() + 60_000 }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	});
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

describe('MCP workspace authorization', () => {
	beforeEach(() => {
		localStorage.clear();
		syncStore.profiles = [
			{ id: 'local', name: 'Private', syncKey: '', createdAt: 0 },
			{ id: 'first', name: 'Personal', syncKey: createSyncIdentity().syncKey, createdAt: 1 },
			{ id: 'second', name: 'Work', syncKey: createSyncIdentity().syncKey, createdAt: 2 }
		];
		syncStore.activeId = 'first';
		pageState.url = new URL(AUTHORIZE_URL);
	});
	afterEach(() => vi.unstubAllGlobals());

	function confirmOrigin() {
		return fireEvent.click(
			screen.getByRole('checkbox', { name: /I run the MCP server at scrapscache-mcp/ })
		);
	}

	it('offers two reachable workspaces even without local sync status markers', async () => {
		const fetch = mockRelay();
		render(AuthorizePage);

		const personal = (await screen.findByRole('radio', { name: /Personal/ })) as HTMLInputElement;
		const work = screen.getByRole('radio', { name: /Work/ }) as HTMLInputElement;
		const local = screen.getByRole('radio', { name: /Private/ }) as HTMLInputElement;
		const allow = screen.getByRole('button', { name: 'Allow access' }) as HTMLButtonElement;

		expect(personal.disabled).toBe(false);
		expect(work.disabled).toBe(false);
		expect(local.disabled).toBe(true);
		expect(allow.disabled).toBe(true);
		expect(fetch).toHaveBeenCalled();

		await fireEvent.click(work);
		expect(work.checked).toBe(true);
		expect(personal.checked).toBe(false);
		await confirmOrigin();
		expect(allow.disabled).toBe(false);
		expect(screen.getByText('Work', { selector: 'strong' })).toBeTruthy();
	});

	it('automatically selects the sole reachable workspace', async () => {
		syncStore.profiles = syncStore.profiles.filter((profile) => profile.id !== 'second');
		mockRelay();
		render(AuthorizePage);

		expect(
			((await screen.findByRole('radio', { name: /Personal/ })) as HTMLInputElement).checked
		).toBe(true);
		await confirmOrigin();
		expect(
			(screen.getByRole('button', { name: 'Allow access' }) as HTMLButtonElement).disabled
		).toBe(false);
		expect((screen.getByRole('radio', { name: /Private/ }) as HTMLInputElement).disabled).toBe(
			true
		);
	});

	it('disables a deleted cloud account while keeping a reachable one selectable', async () => {
		const staleKey = syncStore.profiles.find((profile) => profile.id === 'second')!.syncKey;
		mockRelay(identityFromSyncKey(staleKey).accountId);
		render(AuthorizePage);

		const personal = (await screen.findByRole('radio', { name: /Personal/ })) as HTMLInputElement;
		const work = screen.getByRole('radio', { name: /Work/ }) as HTMLInputElement;
		expect(personal.checked).toBe(true);
		expect(work.disabled).toBe(true);
		expect(screen.getByText('Some workspaces are unavailable for MCP.')).toBeTruthy();
	});

	it('does not offer a local-only workspace for MCP', async () => {
		syncStore.profiles = syncStore.profiles.filter((profile) => profile.id === 'local');
		const fetch = mockRelay();
		render(AuthorizePage);

		expect(await screen.findByText('No synced workspace on this device.')).toBeTruthy();
		expect(
			(screen.getByRole('button', { name: 'Allow access' }) as HTMLButtonElement).disabled
		).toBe(true);
		expect((screen.getByRole('radio', { name: /Private/ }) as HTMLInputElement).disabled).toBe(
			true
		);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('names the callback host and withholds the key until the user confirms it', async () => {
		syncStore.profiles = syncStore.profiles.filter((profile) => profile.id !== 'second');
		// The handshake seals the grant to the MCP server's key, so it must be a real one.
		const mcpPublicKey = bytesToBase64Url(
			x25519.getPublicKey(crypto.getRandomValues(new Uint8Array(32)))
		);
		pageState.url = new URL(AUTHORIZE_URL);
		pageState.url.searchParams.set('mcp_public_key', mcpPublicKey);
		mockRelay();
		const replace = vi.fn();
		Object.defineProperty(window, 'location', {
			configurable: true,
			value: { ...window.location, replace, assign: vi.fn() }
		});
		render(AuthorizePage);

		await screen.findByRole('radio', { name: /Personal/ });
		const allow = screen.getByRole('button', { name: 'Allow access' }) as HTMLButtonElement;
		expect(
			screen.getByText('Allowing sends your sync key to scrapscache-mcp.kripso.workers.dev')
		).toBeTruthy();
		expect(allow.disabled).toBe(true);
		await fireEvent.click(allow);
		expect(replace).not.toHaveBeenCalled();

		await confirmOrigin();
		expect(allow.disabled).toBe(false);
		await fireEvent.click(allow);
		expect(replace).toHaveBeenCalledTimes(1);
		const target = new URL(replace.mock.calls[0][0] as string);
		expect(target.host).toBe('scrapscache-mcp.kripso.workers.dev');
		expect(new URLSearchParams(target.hash.slice(1)).get('session_id')).toBe('test-session');
	});

	it('flags a client the MCP server did not verify and shows where the code goes', async () => {
		pageState.url = new URL(
			`${AUTHORIZE_URL}&client_name=Claude&client_verified=false&client_redirect=attacker.example`
		);
		mockRelay();
		render(AuthorizePage);

		await screen.findByRole('radio', { name: /Personal/ });
		expect(screen.getByText('Unverified client')).toBeTruthy();
		expect(screen.getByText(/sends the authorization code to attacker\.example/)).toBeTruthy();
	});

	it('shows a verified provider client without the warning', async () => {
		pageState.url = new URL(
			`${AUTHORIZE_URL}&client_name=Claude&client_verified=true&client_redirect=claude.ai`
		);
		mockRelay();
		render(AuthorizePage);

		await screen.findByRole('radio', { name: /Personal/ });
		expect(screen.queryByText('Unverified client')).toBeNull();
		expect(screen.getByText(/is a verified client/)).toBeTruthy();
		expect(screen.getByText(/authorization code to claude\.ai/)).toBeTruthy();
	});
});
