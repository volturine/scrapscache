import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpcomingReminder } from '#lib/stores/reminders.svelte.js';

const TOKEN = 'ab'.repeat(32);

const ios = vi.hoisted(() => ({
	/** What iOS answers a registration with: a token, or null for a refusal. */
	token: null as string | null,
	listeners: new Map<string, (value: { value: string }) => void>(),
	register: vi.fn(async () => undefined)
}));
const relay = vi.hoisted(() => ({
	profiles: [] as Array<{ id: string; syncKey: string | null }>,
	/** The server the app is set to sync with. */
	server: 'https://relay.example',
	status: 200,
	fetch: vi.fn(),
	/** Requests made without a workspace's key: the phone taking itself off an account. */
	open: vi.fn()
}));

vi.mock('@capacitor/push-notifications', () => ({
	PushNotifications: {
		addListener: async (name: string, handler: (value: { value: string }) => void) => {
			ios.listeners.set(name, handler);
			return { remove: async () => undefined };
		},
		register: ios.register
	}
}));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {} }));
vi.mock('@capacitor/app', () => ({
	App: { getInfo: async () => ({ id: 'com.scrapscache.app' }) }
}));
vi.mock('#lib/stores/sync.svelte.js', () => ({
	syncStore: {
		get profiles() {
			return relay.profiles;
		},
		authorizedFetch: relay.fetch
	}
}));
vi.mock('#lib/serverOrigin.svelte.js', () => ({ serverOrigin: () => relay.server }));
vi.mock('#lib/syncPairing.js', () => ({
	identityFromSyncKey: (syncKey: string) => ({ accountId: `account-of-${syncKey}` })
}));
vi.mock('#lib/reminderWake.js', () => ({
	reminderDeviceId: (accountId: string) => `device-for-${accountId}`
}));

const reminder = (workspaceId: string, wakeId: string): UpcomingReminder => ({
	workspaceId,
	noteId: 'note',
	wakeId,
	at: Date.UTC(2030, 0, 7, 9, 0),
	title: 'Note'
});

type Sent = { deviceId: string; apns: { token: string; topic: string }; held: string[] };

/** What the relay was sent, by the account it was sent under. */
function sent(): Map<string, Sent> {
	return new Map(
		relay.fetch.mock.calls.map(([, init, account]) => [
			(account as { accountId: string }).accountId,
			JSON.parse(String((init as RequestInit).body)) as Sent
		])
	);
}

/** Where the phone asked to be taken off, by its token alone, in order: the server and the account. */
function leftAt(): Array<[server: string, accountId: string]> {
	return relay.open.mock.calls.map(([url, init]) => {
		expect((init as RequestInit).method).toBe('DELETE');
		const body = JSON.parse(String((init as RequestInit).body)) as {
			accountId: string;
			apns: { token: string; topic: string };
		};
		expect(body.apns).toEqual({ token: TOKEN, topic: 'com.scrapscache.app' });
		const { origin, pathname } = new URL(String(url));
		expect(pathname).toBe('/api/sync/push/wakes');
		return [origin, body.accountId];
	});
}

/** The accounts the phone asked to be taken off on the server it syncs with. */
function left(): string[] {
	return leftAt().map(([server, accountId]) => {
		expect(server).toBe('https://relay.example');
		return accountId;
	});
}

/** The module as a newly launched app has it: nothing in memory, what was stored still there. */
async function load() {
	vi.resetModules();
	return import('./remotePush.js');
}

beforeEach(() => {
	ios.token = TOKEN;
	ios.listeners.clear();
	ios.register.mockReset();
	ios.register.mockImplementation(async () => {
		if (ios.token) ios.listeners.get('registration')?.({ value: ios.token });
		else ios.listeners.get('registrationError')?.({ value: '' });
	});
	relay.profiles = [
		{ id: 'home', syncKey: 'home-key' },
		{ id: 'work', syncKey: 'work-key' },
		{ id: 'local', syncKey: null }
	];
	relay.status = 200;
	relay.server = 'https://relay.example';
	relay.fetch.mockReset();
	relay.fetch.mockImplementation(async () => new Response(null, { status: relay.status }));
	relay.open.mockReset();
	relay.open.mockImplementation(async () => new Response(null, { status: 204 }));
	vi.stubGlobal('fetch', relay.open);
	localStorage.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('registering the iPhone app for reminder push', () => {
	it('registers the one push token under every synced workspace, with the wakes it holds there', async () => {
		const { registerRemotePush } = await load();
		await registerRemotePush([
			reminder('home', 'wake-b'),
			reminder('work', 'wake-c'),
			reminder('home', 'wake-a'),
			reminder('local', 'wake-d')
		]);
		expect(relay.fetch).toHaveBeenCalledTimes(2);
		expect(relay.fetch.mock.calls[0][0]).toBe('/api/sync/push/wakes');
		expect((relay.fetch.mock.calls[0][1] as RequestInit).method).toBe('POST');
		expect(sent()).toEqual(
			new Map([
				[
					'account-of-home-key',
					{
						deviceId: 'device-for-account-of-home-key',
						apns: { token: TOKEN, topic: 'com.scrapscache.app' },
						held: ['wake-a', 'wake-b']
					}
				],
				[
					'account-of-work-key',
					{
						deviceId: 'device-for-account-of-work-key',
						apns: { token: TOKEN, topic: 'com.scrapscache.app' },
						held: ['wake-c']
					}
				]
			])
		);
	});

	it('tells the relay only of the reminders the system holds', async () => {
		const { registerRemotePush } = await load();
		const { PENDING_LIMIT } = await import('./localNotifications.js');
		const many = Array.from({ length: PENDING_LIMIT + 5 }, (_, index) =>
			reminder('home', `wake-${String(index).padStart(3, '0')}`)
		);
		await registerRemotePush(many);
		expect(sent().get('account-of-home-key')?.held).toHaveLength(PENDING_LIMIT);
	});

	it('says nothing again while a workspace holds the same reminders', async () => {
		const { registerRemotePush } = await load();
		await registerRemotePush([reminder('home', 'wake-a')]);
		await registerRemotePush([reminder('home', 'wake-a')]);
		expect(relay.fetch).toHaveBeenCalledTimes(2);
		relay.fetch.mockClear();
		await registerRemotePush([reminder('home', 'wake-a'), reminder('home', 'wake-b')]);
		expect([...sent().keys()]).toEqual(['account-of-home-key']);
	});

	it('tries a workspace again after the relay did not take it', async () => {
		const { registerRemotePush } = await load();
		relay.status = 503;
		await registerRemotePush([]);
		relay.status = 200;
		relay.fetch.mockClear();
		await registerRemotePush([]);
		expect(relay.fetch).toHaveBeenCalledTimes(2);
	});

	it('registers a workspace again once it syncs here again', async () => {
		const { registerRemotePush } = await load();
		await registerRemotePush([]);
		relay.profiles = [{ id: 'home', syncKey: 'home-key' }];
		await registerRemotePush([]);
		relay.profiles.push({ id: 'work', syncKey: 'work-key' });
		relay.fetch.mockClear();
		await registerRemotePush([]);
		expect([...sent().keys()]).toEqual(['account-of-work-key']);
	});

	it('registers the only synced workspace again after it was unlinked and linked back', async () => {
		const { registerRemotePush } = await load();
		relay.profiles = [{ id: 'home', syncKey: 'home-key' }];
		await registerRemotePush([]);
		// Unlinking removed the phone from the relay; nothing here syncs for a while.
		relay.profiles = [];
		await registerRemotePush([]);
		relay.profiles = [{ id: 'home', syncKey: 'home-key' }];
		relay.fetch.mockClear();
		await registerRemotePush([]);
		expect([...sent().keys()]).toEqual(['account-of-home-key']);
	});

	it.each([
		[501, 'has no Apple key'],
		[400, 'is too old to know phones']
	])('stops asking a relay that answers %i: it %s', async (status) => {
		const { registerRemotePush } = await load();
		relay.status = status;
		await registerRemotePush([]);
		relay.fetch.mockClear();
		await registerRemotePush([reminder('home', 'wake-a')]);
		expect(relay.fetch).not.toHaveBeenCalled();
	});

	it('registers nothing when iOS gives no token, and asks iOS again next time', async () => {
		const { registerRemotePush } = await load();
		ios.token = null;
		await registerRemotePush([]);
		expect(relay.fetch).not.toHaveBeenCalled();
		ios.token = TOKEN;
		await registerRemotePush([]);
		expect(ios.register).toHaveBeenCalledTimes(2);
		expect(relay.fetch).toHaveBeenCalledTimes(2);
	});

	it('goes on without a token when iOS never answers, and uses one that comes late', async () => {
		vi.useFakeTimers();
		try {
			const { registerRemotePush } = await load();
			ios.register.mockImplementation(async () => undefined);
			const round = registerRemotePush([]);
			await vi.advanceTimersByTimeAsync(30_000);
			await round;
			expect(relay.fetch).not.toHaveBeenCalled();
			// The answer arrives after the wait gave up: the next schedule registers with it.
			ios.listeners.get('registration')?.({ value: TOKEN });
			await registerRemotePush([]);
			expect(relay.fetch).toHaveBeenCalledTimes(2);
			expect(ios.register).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it('leaves out a workspace unlinked while iOS was still answering', async () => {
		const { registerRemotePush } = await load();
		ios.register.mockImplementation(async () => {
			relay.profiles = [{ id: 'home', syncKey: 'home-key' }];
			ios.listeners.get('registration')?.({ value: TOKEN });
		});
		await registerRemotePush([]);
		expect([...sent().keys()]).toEqual(['account-of-home-key']);
	});

	it('takes the phone off an account again when its workspace was unlinked mid-registration', async () => {
		const { registerRemotePush } = await load();
		relay.fetch.mockImplementation(async (_path: string, _init: RequestInit, account) => {
			// The unlink happens while the work account's registration is on its way.
			if ((account as { accountId: string }).accountId.includes('work'))
				relay.profiles = [{ id: 'home', syncKey: 'home-key' }];
			return new Response(null, { status: 200 });
		});
		await registerRemotePush([]);
		expect(left()).toEqual(['account-of-work-key']);
		// Linked again later, it registers afresh rather than being taken as already told.
		relay.profiles.push({ id: 'work', syncKey: 'work-key' });
		relay.fetch.mockClear();
		relay.fetch.mockImplementation(async () => new Response(null, { status: 200 }));
		await registerRemotePush([]);
		expect([...sent().keys()]).toEqual(['account-of-work-key']);
	});

	it('asks iOS for nothing while no workspace syncs', async () => {
		const { registerRemotePush } = await load();
		relay.profiles = [{ id: 'local', syncKey: null }];
		await registerRemotePush([reminder('local', 'wake-a')]);
		expect(ios.register).not.toHaveBeenCalled();
		expect(relay.fetch).not.toHaveBeenCalled();
	});

	it('sends only the latest schedule when several arrive during one registration', async () => {
		const { registerRemotePush } = await load();
		const first = registerRemotePush([reminder('home', 'wake-a')]);
		void registerRemotePush([reminder('home', 'wake-b')]);
		const last = registerRemotePush([reminder('home', 'wake-c')]);
		await Promise.all([first, last]);
		const held = relay.fetch.mock.calls
			.map(([, init, account]) => ({
				account: (account as { accountId: string }).accountId,
				held: (JSON.parse(String((init as RequestInit).body)) as Sent).held
			}))
			.filter((call) => call.account === 'account-of-home-key')
			.map((call) => call.held);
		expect(held).toEqual([['wake-a'], ['wake-c']]);
	});
});

describe('a phone that left a workspace', () => {
	it('takes itself off that account by its push token, once', async () => {
		const { registerRemotePush } = await load();
		await registerRemotePush([]);
		expect(left()).toEqual([]);
		relay.profiles = [{ id: 'home', syncKey: 'home-key' }];
		await registerRemotePush([]);
		expect(left()).toEqual(['account-of-work-key']);
		await registerRemotePush([reminder('home', 'wake-a')]);
		expect(left()).toEqual(['account-of-work-key']);
	});

	it('asks again after every launch until the relay answers', async () => {
		let app = await load();
		await app.registerRemotePush([]);
		// Unlinked with no way to the relay: the workspace's key is gone, the phone still registered.
		relay.profiles = [{ id: 'home', syncKey: 'home-key' }];
		relay.open.mockRejectedValue(new TypeError('offline'));
		await app.registerRemotePush([]);
		app = await load();
		relay.open.mockResolvedValue(new Response(null, { status: 503 }));
		await app.registerRemotePush([]);
		app = await load();
		relay.open.mockResolvedValue(new Response(null, { status: 204 }));
		await app.registerRemotePush([]);
		expect(left()).toEqual(Array(3).fill('account-of-work-key'));
		app = await load();
		await app.registerRemotePush([]);
		expect(left()).toHaveLength(3);
	});

	it('takes itself off the last account too, with nothing left to register', async () => {
		let app = await load();
		relay.profiles = [{ id: 'home', syncKey: 'home-key' }];
		await app.registerRemotePush([]);
		relay.profiles = [];
		relay.fetch.mockClear();
		app = await load();
		await app.registerRemotePush([]);
		expect(left()).toEqual(['account-of-home-key']);
		expect(relay.fetch).not.toHaveBeenCalled();
	});

	it('is taken off even an account whose registration never got through', async () => {
		let app = await load();
		relay.status = 503;
		await app.registerRemotePush([]);
		relay.profiles = [{ id: 'home', syncKey: 'home-key' }];
		app = await load();
		await app.registerRemotePush([]);
		// The relay may have taken the registration before its answer was lost.
		expect(left()).toEqual(['account-of-work-key']);
	});

	it('stays on an account whose workspace was linked again before the relay answered', async () => {
		const { registerRemotePush } = await load();
		await registerRemotePush([]);
		relay.profiles = [{ id: 'home', syncKey: 'home-key' }];
		relay.open.mockImplementation(async () => {
			relay.profiles.push({ id: 'work', syncKey: 'work-key' });
			return new Response(null, { status: 204 });
		});
		await registerRemotePush([]);
		relay.fetch.mockClear();
		relay.open.mockClear();
		await registerRemotePush([]);
		// It registers there again, and is not asked off an account it syncs with.
		expect([...sent().keys()]).toEqual(['account-of-work-key']);
		expect(left()).toEqual([]);
	});

	it('is told afresh when it was unlinked and linked again within one round', async () => {
		const { registerRemotePush } = await load();
		await registerRemotePush([]);
		// Home's schedule changed, so only home registers again. While that is on
		// its way, work is unlinked: the round takes the phone off it.
		relay.fetch.mockImplementation(async () => {
			relay.profiles = [{ id: 'home', syncKey: 'home-key' }];
			return new Response(null, { status: 200 });
		});
		await registerRemotePush([reminder('home', 'wake-a')]);
		expect(left()).toEqual(['account-of-work-key']);
		// Linked again before the next round, which never saw it gone.
		relay.profiles.push({ id: 'work', syncKey: 'work-key' });
		relay.fetch.mockReset();
		relay.fetch.mockImplementation(async () => new Response(null, { status: 200 }));
		await registerRemotePush([reminder('home', 'wake-a')]);
		expect([...sent().keys()]).toEqual(['account-of-work-key']);
	});

	it('takes itself off the relay it was pointed away from, and registers with the new one', async () => {
		const { registerRemotePush } = await load();
		await registerRemotePush([]);
		relay.server = 'https://other.example';
		relay.fetch.mockClear();
		await registerRemotePush([]);
		// The same schedule is news to the new relay.
		expect([...sent().keys()].sort()).toEqual(['account-of-home-key', 'account-of-work-key']);
		expect(leftAt().sort()).toEqual([
			['https://relay.example', 'account-of-home-key'],
			['https://relay.example', 'account-of-work-key']
		]);
		// Unlinked later, the workspace is left on the relay the phone is on now.
		relay.open.mockClear();
		relay.profiles = [{ id: 'home', syncKey: 'home-key' }];
		await registerRemotePush([]);
		expect(leftAt()).toEqual([['https://other.example', 'account-of-work-key']]);
	});

	it('keeps asking the old relay after a move, while registering with the new one fails', async () => {
		let app = await load();
		await app.registerRemotePush([]);
		relay.server = 'https://other.example';
		relay.status = 503;
		relay.open.mockRejectedValue(new TypeError('offline'));
		await app.registerRemotePush([]);
		app = await load();
		relay.open.mockReset();
		relay.open.mockResolvedValue(new Response(null, { status: 204 }));
		await app.registerRemotePush([]);
		expect(leftAt().sort()).toEqual([
			['https://relay.example', 'account-of-home-key'],
			['https://relay.example', 'account-of-work-key']
		]);
	});

	it('still takes itself off while notifications are not allowed, and registers nowhere', async () => {
		let app = await load();
		await app.registerRemotePush([]);
		relay.profiles = [{ id: 'home', syncKey: 'home-key' }];
		relay.fetch.mockClear();
		app = await load();
		// Notifications were turned off since: the app has no schedule to hand over.
		await app.registerRemotePush(null);
		expect(left()).toEqual(['account-of-work-key']);
		expect(relay.fetch).not.toHaveBeenCalled();
		// With nothing left to leave, iOS is not even asked for a token.
		ios.register.mockClear();
		await app.registerRemotePush(null);
		expect(ios.register).not.toHaveBeenCalled();
	});

	it('registers nowhere when it cannot keep track of where it registered', async () => {
		const { registerRemotePush } = await load();
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('full', 'QuotaExceededError');
		});
		await registerRemotePush([]);
		expect(relay.fetch).not.toHaveBeenCalled();
		expect(relay.open).not.toHaveBeenCalled();
	});
});
