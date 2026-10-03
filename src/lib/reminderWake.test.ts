import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	fetchReminderWakes,
	publishReminderWakes,
	registerAllReminderDevices,
	reminderDeviceId,
	unregisterReminderDevice,
	workspacePushScope
} from './reminderWake';
import { syncStore } from '#lib/stores/sync.svelte.js';
import { createSyncIdentity, identityFromSyncKey } from '#lib/syncPairing.js';

const ORIGIN = window.location.origin;

/**
 * A browser's service worker registrations: one per scope, each with a push
 * subscription and address of its own, as the browser keeps them.
 */
function fakeServiceWorkers(existing: string[] = []) {
	const registrations = new Map<string, ReturnType<typeof registrationFor>>();
	let next = 0;
	function registrationFor(scope: string) {
		let subscription: {
			endpoint: string;
			options: { applicationServerKey: ArrayBuffer };
			unsubscribe: ReturnType<typeof vi.fn>;
			toJSON: () => unknown;
		} | null = null;
		const registration = {
			scope,
			active: {},
			unregister: vi.fn(async () => registrations.delete(scope)),
			pushManager: {
				getSubscription: vi.fn(async () => subscription),
				subscribe: vi.fn(async () => {
					const endpoint = `https://push.example/${(next += 1)}`;
					subscription = {
						endpoint,
						options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
						unsubscribe: vi.fn(async () => {
							subscription = null;
							return true;
						}),
						toJSON: () => ({ endpoint, keys: { p256dh: 'public-key', auth: 'auth-key' } })
					};
					return subscription;
				})
			}
		};
		return registration;
	}
	const container = {
		register: vi.fn(async (_script: string, options: { scope: string }) => {
			const scope = new URL(options.scope, ORIGIN).href;
			const registration = registrations.get(scope) ?? registrationFor(scope);
			registrations.set(scope, registration);
			return registration;
		}),
		// Like the browser: the registration whose scope best matches, else none.
		getRegistration: vi.fn(async (url: string) => {
			const matches = [...registrations.values()].filter((registration) =>
				String(url).startsWith(registration.scope)
			);
			return matches.sort((a, b) => b.scope.length - a.scope.length)[0];
		}),
		getRegistrations: vi.fn(async () => [...registrations.values()])
	};
	for (const scope of existing) container.register('/sw.js', { scope });
	return { container, registrations };
}

function workspace(id: string) {
	return { id, name: id, syncKey: createSyncIdentity().syncKey, createdAt: 1 };
}

function stubBrowser(container: object) {
	vi.stubGlobal('Notification', { permission: 'granted' });
	vi.stubGlobal('PushManager', function PushManager() {});
	vi.stubGlobal('navigator', { serviceWorker: container });
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL | Request) =>
			String(input).endsWith('/vapid')
				? new Response(JSON.stringify({ publicKey: 'AQID' }))
				: new Response(null, { status: 404 })
		)
	);
}

type RegistrationPost = { account: string; deviceId: string; subscription: { endpoint: string } };

function registrationPosts(requestMock: { mock: { calls: unknown[][] } }): RegistrationPost[] {
	return (requestMock.mock.calls as [string, RequestInit | undefined, unknown][])
		.filter(([path, init]) => path === '/api/sync/push/wakes' && init?.method === 'POST')
		.map(([, init, account]) => ({
			account: (account as { accountId: string }).accountId,
			...(JSON.parse(String((init as RequestInit).body)) as {
				deviceId: string;
				subscription: { endpoint: string };
			})
		}));
}

describe('reminder wake requests', () => {
	let profiles: typeof syncStore.profiles;

	beforeEach(() => {
		profiles = syncStore.profiles;
	});

	afterEach(() => {
		syncStore.account = null;
		syncStore.profiles = profiles;
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('does not publish an unchanged wake snapshot twice', async () => {
		syncStore.account = createSyncIdentity();
		vi.spyOn(syncStore, 'committedRevision').mockResolvedValue(3);
		const requestMock = vi
			.spyOn(syncStore, 'authorizedFetch')
			.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
		const notes = [
			{
				id: 'reminder-note',
				title: 'Later',
				body: '',
				reminder: Date.now() + 60_000,
				archived: false,
				trashed: false
			}
		];

		expect(await publishReminderWakes(notes)).toHaveLength(1);
		expect(await publishReminderWakes(notes)).toHaveLength(1);
		expect(requestMock).toHaveBeenCalledOnce();
		expect(requestMock).toHaveBeenCalledWith(
			'/api/sync/push/wakes',
			expect.objectContaining({ method: 'PUT' })
		);
	});

	it('publishes an unchanged wake snapshot again after the sync revision advances', async () => {
		syncStore.account = createSyncIdentity();
		let revision = 3;
		vi.spyOn(syncStore, 'committedRevision').mockImplementation(async () => revision);
		const requestMock = vi
			.spyOn(syncStore, 'authorizedFetch')
			.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
		const notes = [
			{
				id: 'revision-reminder',
				title: 'Later',
				body: '',
				reminder: Date.now() + 60_000,
				archived: false,
				trashed: false
			}
		];

		expect(await publishReminderWakes(notes)).toHaveLength(1);
		revision = 4;
		expect(await publishReminderWakes(notes)).toHaveLength(1);
		expect(requestMock).toHaveBeenCalledTimes(2);
		expect(
			JSON.parse(String(requestMock.mock.calls[1]?.[1]?.body)) as { revision: number }
		).toMatchObject({ revision: 4 });
	});

	it('gives every synced workspace a subscription and device id of its own', async () => {
		const { container, registrations } = fakeServiceWorkers();
		stubBrowser(container);
		const home = workspace('home');
		const work = workspace('work');
		syncStore.profiles = [home, work, { ...workspace('private'), syncKey: '' }];
		const requestMock = vi
			.spyOn(syncStore, 'authorizedFetch')
			.mockResolvedValue(new Response(JSON.stringify({ ok: true })));

		expect(await registerAllReminderDevices()).toBe(true);

		expect([...registrations.keys()].sort()).toEqual([
			new URL(workspacePushScope('home'), ORIGIN).href,
			new URL(workspacePushScope('work'), ORIGIN).href
		]);
		const posts = registrationPosts(requestMock);
		expect(posts.map((post) => post.account).sort()).toEqual(
			[
				identityFromSyncKey(home.syncKey).accountId,
				identityFromSyncKey(work.syncKey).accountId
			].sort()
		);
		// Nothing the relay sees ties the two accounts to one browser.
		expect(new Set(posts.map((post) => post.subscription.endpoint)).size).toBe(2);
		expect(new Set(posts.map((post) => post.deviceId)).size).toBe(2);
		expect(
			posts.find((post) => post.account === identityFromSyncKey(home.syncKey).accountId)
		).toMatchObject({
			deviceId: reminderDeviceId(identityFromSyncKey(home.syncKey).accountId)
		});
	});

	it('does not register a workspace again after every sync', async () => {
		const { container } = fakeServiceWorkers();
		stubBrowser(container);
		syncStore.profiles = [workspace('home')];
		const requestMock = vi
			.spyOn(syncStore, 'authorizedFetch')
			.mockResolvedValue(new Response(JSON.stringify({ ok: true })));

		expect(await registerAllReminderDevices()).toBe(true);
		expect(await registerAllReminderDevices()).toBe(true);
		expect(registrationPosts(requestMock)).toHaveLength(1);
	});

	it('does nothing until notifications are allowed', async () => {
		const { container, registrations } = fakeServiceWorkers();
		stubBrowser(container);
		vi.stubGlobal('Notification', { permission: 'default' });
		syncStore.profiles = [workspace('home')];
		const requestMock = vi.spyOn(syncStore, 'authorizedFetch');

		expect(await registerAllReminderDevices()).toBe(false);
		expect(registrations.size).toBe(0);
		expect(requestMock).not.toHaveBeenCalled();
	});

	it('drops the shared subscription and those of workspaces no longer synced here', async () => {
		const { container, registrations } = fakeServiceWorkers(['/', workspacePushScope('gone')]);
		for (const registration of registrations.values()) await registration.pushManager.subscribe();
		const root = registrations.get(`${ORIGIN}/`)!;
		stubBrowser(container);
		syncStore.profiles = [workspace('home')];
		vi.spyOn(syncStore, 'authorizedFetch').mockResolvedValue(
			new Response(JSON.stringify({ ok: true }))
		);

		await registerAllReminderDevices();

		expect(await root.pushManager.getSubscription()).toBeNull();
		expect(registrations.has(`${ORIGIN}/`)).toBe(true);
		expect(registrations.has(new URL(workspacePushScope('gone'), ORIGIN).href)).toBe(false);
		expect(registrations.has(new URL(workspacePushScope('home'), ORIGIN).href)).toBe(true);
	});

	it("removes only that workspace's subscription and tells the relay", async () => {
		const { container, registrations } = fakeServiceWorkers();
		stubBrowser(container);
		const home = workspace('home');
		const work = workspace('work');
		syncStore.profiles = [home, work];
		const requestMock = vi
			.spyOn(syncStore, 'authorizedFetch')
			.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
		await registerAllReminderDevices();

		await unregisterReminderDevice(home);

		expect([...registrations.keys()]).toEqual([new URL(workspacePushScope('work'), ORIGIN).href]);
		const account = identityFromSyncKey(home.syncKey);
		expect(requestMock).toHaveBeenCalledWith(
			'/api/sync/push/wakes',
			expect.objectContaining({
				method: 'DELETE',
				keepalive: true,
				body: JSON.stringify({ deviceId: reminderDeviceId(account.accountId) })
			}),
			expect.objectContaining({ accountId: account.accountId })
		);
	});

	it('fetches wakes for a synced workspace', async () => {
		const home = workspace('home');
		const wake = { id: 'a'.repeat(43), fireAt: 12345 };
		const requestMock = vi
			.spyOn(syncStore, 'authorizedFetch')
			.mockResolvedValue(new Response(JSON.stringify({ revision: 5, wakes: [wake] })));

		const result = await fetchReminderWakes(home);
		expect(result).toEqual({ revision: 5, wakes: [wake] });
		expect(requestMock).toHaveBeenCalledWith(
			'/api/sync/push/wakes',
			{ method: 'GET' },
			expect.objectContaining({ accountId: identityFromSyncKey(home.syncKey).accountId })
		);
	});
});
