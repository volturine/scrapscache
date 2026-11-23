import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelayClient } from './relayClient';
import { createSyncIdentity } from './syncPairing';

describe('what a window calls itself to the relay', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('keeps one name per account, and never the same name for two accounts', () => {
		const relay = new RelayClient();
		const first = createSyncIdentity();
		const second = createSyncIdentity();

		expect(relay.clientId(first.accountId)).toBe(relay.clientId(first.accountId));
		expect(relay.clientId(second.accountId)).not.toBe(relay.clientId(first.accountId));
		// Another window is another client of the same account.
		expect(new RelayClient().clientId(first.accountId)).not.toBe(relay.clientId(first.accountId));
	});

	it('sends each account its own name, so the relay cannot tell from it that they share a browser', async () => {
		const relay = new RelayClient();
		vi.spyOn(relay, 'accessToken').mockResolvedValue('token');
		const sent: Array<string | null> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				sent.push(new Headers(init?.headers).get('x-sync-client-id'));
				return new Response('{}');
			})
		);
		const first = createSyncIdentity();
		const second = createSyncIdentity();

		await relay.authorizedFetch('/api/sync/reminders', {}, first);
		await relay.authorizedFetch('/api/sync/reminders', {}, second);
		await relay.authorizedFetch('/api/sync/history', {}, first);

		expect(sent).toEqual([
			relay.clientId(first.accountId),
			relay.clientId(second.accountId),
			relay.clientId(first.accountId)
		]);
		expect(sent[0]).not.toBe(sent[1]);
	});
});

describe('a sign-in the relay answers with a no', () => {
	afterEach(() => vi.unstubAllGlobals());

	const signInAnswers = (status: number, body: unknown) =>
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(body), { status }))
		);
	const send = (relay: RelayClient, account: ReturnType<typeof createSyncIdentity>) =>
		relay.sendSyncRequest('/api/sync/v2/delta', '{}', 2, () => undefined, account);

	it('is a refusal that stands, when the key was deleted from the relay', async () => {
		const relay = new RelayClient();
		const retired = vi.fn();
		relay.onRetired = retired;
		const account = createSyncIdentity();
		signInAnswers(410, { retired: true });

		const answer = await send(relay, account);

		// With its status a sync is refused, not tried again for as long as it has something queued.
		expect(answer).toMatchObject({ success: false, status: 410 });
		expect(answer.unreachable).toBeUndefined();
		expect(retired).toHaveBeenCalledWith(account);
	});

	it('is a relay that was not reached, when it could not serve the sign-in', async () => {
		const relay = new RelayClient();
		signInAnswers(503, {});

		const answer = await send(relay, createSyncIdentity());

		// Nothing is wrong on this device: it is not shown as an error.
		expect(answer).toMatchObject({ success: false, status: 503, unreachable: true });
	});
});
