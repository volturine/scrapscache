import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncIdentity, identityFromSyncKey } from '$lib/syncPairing';
import { syncStore } from '$lib/stores/sync.svelte';
import AuthorizePage from './+page.svelte';

vi.mock('$app/state', () => ({
	page: {
		url: new URL(
			'https://scrapscache.com/mcp/authorize?session_id=test-session&mcp_public_key=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH&mcp_callback=https%3A%2F%2Fscrapscache-mcp.kripso.workers.dev%2Foauth%2Fcallback&client_name=ChatGPT'
		)
	}
}));

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
	});
	afterEach(() => vi.unstubAllGlobals());

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
});
