import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredProfile } from '#lib/profiles.js';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { ProfileCoordinator } from './profiles.svelte';
import { notesStore } from './notes.svelte';
import { SYNC_LOCK, syncScheduler } from './syncScheduler';
import { relaySync, syncStore } from './sync.svelte';
import { relay as appRelay } from '#lib/relayClient.js';
import { TEST_WORKSPACE } from '../../tests/workspace';

// A sync runs for as long as the relay takes to answer. On a poor connection that
// is minutes. Switching workspace has no part in it: the switch goes ahead, and the
// sync runs on from its workspace's database. Only something that rewrites the
// workspace that is syncing takes its lock, and then without waiting for the relay.

const ROUND_DONE = {
	cursor: 1,
	envelopes: [],
	conflicts: [],
	hasMore: false,
	reset: false,
	writesAccepted: true
};

const relay = { answers: false };
let requests: RelayXhr[] = [];

/** A relay request that is answered at once, or never: only `abort` ends it then. */
class RelayXhr {
	status = 0;
	responseText = '';
	timeout = 0;
	upload = { onprogress: null };
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	ontimeout: (() => void) | null = null;
	onabort: (() => void) | null = null;
	onprogress: (() => void) | null = null;
	onloadend: (() => void) | null = null;
	aborted = false;
	open(): void {}
	setRequestHeader(): void {}
	getResponseHeader(): string | null {
		return null;
	}
	send(): void {
		requests.push(this);
		if (relay.answers) queueMicrotask(() => this.answer());
	}
	answer(): void {
		this.status = 200;
		this.responseText = JSON.stringify(ROUND_DONE);
		this.onload?.();
		this.onloadend?.();
	}
	abort(): void {
		this.aborted = true;
		this.onabort?.();
		this.onloadend?.();
	}
}

/** A workspace's sync lock as the browser grants it: one holder at a time, in request order. */
function serialLocks() {
	const chains = new Map<string, Promise<unknown>>();
	return {
		request: <T>(name: string, ...rest: unknown[]): Promise<T> => {
			const run = rest.at(-1) as () => Promise<T>;
			// Only the sync locks are under test; the others are theirs to take.
			if (!name.startsWith(SYNC_LOCK)) return run();
			const held = (chains.get(name) ?? Promise.resolve()).then(run);
			chains.set(
				name,
				held.catch(() => undefined)
			);
			return held;
		}
	};
}

function workspace(id: string, synced: boolean, createdAt: number): StoredProfile {
	return { id, name: id, syncKey: synced ? createSyncIdentity().syncKey : '', createdAt };
}

/** Open a workspace on a device where every workspace has caught up with the relay. */
async function open(target: StoredProfile, others: StoredProfile[]) {
	syncStore.profiles = [target, ...others];
	syncStore.activateProfile(target);
	relay.answers = true;
	await notesStore.reloadForProfile();
	// A load asks every workspace to catch up; the requests after it are the test's own.
	await vi.waitFor(() =>
		expect(syncStore.profiles.some(({ id }) => syncScheduler.syncing(id))).toBe(false)
	);
	requests = [];
}

/** Start a sync and wait until its request is out and unanswered. */
async function syncAgainstSilentRelay(): Promise<{ flight: Promise<boolean> }> {
	relay.answers = false;
	const flight = syncScheduler.request(syncStore.activeId);
	await vi.waitFor(() => expect(requests).toHaveLength(1));
	// Wrapped: returning the flight itself would wait for it.
	return { flight };
}

describe.each([
	['with Web Locks', true],
	['without Web Locks', false]
])('a workspace change while a sync waits on the relay, %s', (_name, webLocks) => {
	beforeEach(() => {
		requests = [];
		vi.stubGlobal('XMLHttpRequest', RelayXhr);
		if (webLocks) vi.stubGlobal('navigator', { ...navigator, locks: serialLocks() });
		vi.spyOn(appRelay, 'accessToken').mockResolvedValue('token');
	});

	afterEach(async () => {
		relay.answers = true;
		// A workspace left behind may still be waiting on the relay.
		await syncScheduler.reset();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		syncStore.activateLocalWorkspace(TEST_WORKSPACE);
		syncStore.profiles = [];
		await notesStore.reloadForProfile();
		localStorage.clear();
	});

	it('switches workspace without the relay answering, and the sync runs on undisturbed', async () => {
		const syncing = workspace('syncing', true, 1);
		const other = workspace('other', false, 2);
		await open(syncing, [other]);
		const { flight } = await syncAgainstSilentRelay();
		expect(syncScheduler.syncing(syncStore.activeId)).toBe(true);

		expect(await new ProfileCoordinator().switchTo(other.id)).toEqual({ success: true });

		expect(syncStore.activeId).toBe(other.id);
		// The request that was out is still out: the switch did not touch it.
		expect(requests).toHaveLength(1);
		expect(requests[0].aborted).toBe(false);
		// The workspace arrived in is not syncing, and nothing failed. The one left
		// behind is still syncing, and whoever asked for its sync still waits.
		expect(syncScheduler.syncing(syncStore.activeId)).toBe(false);
		expect(syncScheduler.syncing(syncing.id)).toBe(true);
		expect(syncStore.lastError).toBeNull();
		expect(notesStore.lastPersistError).toBeNull();

		// The relay answers at last: the same request settles the sync that was asked for.
		relay.answers = true;
		requests[0].answer();
		expect(await flight).toBe(true);
		expect(requests.every((request) => !request.aborted)).toBe(true);
		expect(syncStore.activeId).toBe(other.id);
		expect(syncStore.lastError).toBeNull();
	});

	it('syncs the workspace arrived in while the one left is still waiting on the relay', async () => {
		const syncing = workspace('syncing', true, 1);
		const other = workspace('other-synced', true, 2);
		await open(syncing, [other]);
		const { flight: left } = await syncAgainstSilentRelay();
		const synced: string[] = [];
		const syncWorkspace = relaySync.sync.bind(relaySync);
		vi.spyOn(relaySync, 'sync').mockImplementation((profile, ...rest) => {
			synced.push(profile.id);
			return syncWorkspace(profile, ...rest);
		});

		relay.answers = true;
		expect(await new ProfileCoordinator().switchTo(other.id)).toEqual({ success: true });

		// Its own sync starts and ends while the first workspace's request is still out.
		expect(await syncScheduler.catchUp(syncStore.activeId)).toBe(true);
		expect(synced).toEqual([other.id]);
		expect(requests[0].aborted).toBe(false);
		expect(syncScheduler.syncing(syncing.id)).toBe(true);

		requests[0].answer();
		expect(await left).toBe(true);
		expect(requests.some((request) => request.aborted)).toBe(false);
	});

	it('leaves a sync alone when another workspace is removed', async () => {
		const syncing = workspace('syncing', true, 1);
		const spare = workspace('spare', false, 2);
		await open(syncing, [spare]);
		const { flight } = await syncAgainstSilentRelay();

		expect(await new ProfileCoordinator().remove(spare.id)).toEqual({ success: true });

		expect(requests).toHaveLength(1);
		expect(requests[0].aborted).toBe(false);
		relay.answers = true;
		requests[0].answer();
		expect(await flight).toBe(true);
		expect(syncStore.activeId).toBe(syncing.id);
		expect(syncStore.lastError).toBeNull();
		expect(notesStore.lastPersistError).toBeNull();
	});

	it('takes the lock from the sync of a workspace that is being unlinked', async () => {
		const syncing = workspace('syncing', true, 1);
		await open(syncing, []);
		const { flight } = await syncAgainstSilentRelay();

		expect(await new ProfileCoordinator().unlink(syncing.id)).toEqual({ success: true });

		// The relay never answered: unlinking did not wait for it.
		expect(requests[0].aborted).toBe(true);
		expect(await flight).toBe(false);
		expect(syncStore.isLoggedIn).toBe(false);
		expect(requests).toHaveLength(1);
	});

	it('gives up its round for a rewrite of the workspace in another window, then goes again', async () => {
		const syncing = workspace('syncing', true, 1);
		await open(syncing, []);
		const { flight } = await syncAgainstSilentRelay();
		const { channel } = syncScheduler as unknown as { channel: BroadcastChannel };

		relay.answers = true;
		channel.onmessage?.({ data: { type: 'rewrite', pid: syncing.id } } as MessageEvent);

		expect(requests[0].aborted).toBe(true);
		expect(await flight).toBe(true);
		expect(requests.length).toBeGreaterThan(1);
	});

	it('tells other windows about a rewrite of a workspace, and nothing about a switch', async () => {
		const here = workspace('here', false, 1);
		const other = workspace('other', false, 2);
		const spare = workspace('spare', true, 3);
		await open(here, [other, spare]);
		const postMessage = vi.fn();
		const store = syncScheduler as unknown as { channel: unknown };
		const channel = store.channel;
		store.channel = { postMessage };
		try {
			expect(await new ProfileCoordinator().switchTo(other.id)).toEqual({ success: true });
			expect(postMessage).not.toHaveBeenCalled();

			expect(await new ProfileCoordinator().unlink(spare.id)).toEqual({ success: true });
			expect(postMessage).toHaveBeenCalledWith({ type: 'rewrite', pid: spare.id });
		} finally {
			store.channel = channel;
		}
	});
});
