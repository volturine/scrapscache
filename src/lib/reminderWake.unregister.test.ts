import { afterEach, describe, expect, it, vi } from 'vitest';
import { unregisterReminderDevice } from './reminderWake';
import { syncStore } from '#lib/stores/sync.svelte.js';
import { createSyncIdentity, identityFromSyncKey } from '#lib/syncPairing.js';

/**
 * Issue #85: the server-side device unsubscribe must be observable. A failed
 * DELETE rejects so callers can surface it; success resolves.
 */
describe('unregisterReminderDevice failure visibility', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	const workspace = { id: 'home', syncKey: createSyncIdentity().syncKey };
	const account = identityFromSyncKey(workspace.syncKey);

	function stubBrowser() {
		vi.stubGlobal('Notification', { permission: 'default' });
		vi.stubGlobal('PushManager', function PushManager() {});
		vi.stubGlobal('navigator', {
			serviceWorker: { getRegistration: async () => undefined, ready: Promise.resolve() }
		});
	}

	it('resolves when the relay accepts the unsubscribe', async () => {
		stubBrowser();
		const fetchMock = vi
			.spyOn(syncStore, 'authorizedFetch')
			.mockResolvedValue(new Response(null, { status: 204 }));

		await expect(unregisterReminderDevice(workspace)).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/sync/push/wakes',
			expect.objectContaining({ method: 'DELETE', keepalive: true }),
			expect.objectContaining({ accountId: account.accountId })
		);
	});

	it('rejects when the relay rejects the unsubscribe', async () => {
		stubBrowser();
		vi.spyOn(syncStore, 'authorizedFetch').mockResolvedValue(new Response(null, { status: 500 }));

		await expect(unregisterReminderDevice(workspace)).rejects.toThrow(/500/);
	});

	it('rejects when the request never leaves the device', async () => {
		stubBrowser();
		vi.spyOn(syncStore, 'authorizedFetch').mockRejectedValue(new TypeError('Failed to fetch'));

		await expect(unregisterReminderDevice(workspace)).rejects.toThrow(/relay/);
	});
});
