import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredProfile } from '#lib/profiles.js';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { ProfileCoordinator } from './profiles.svelte';
import { notesStore } from './notes.svelte';
import { SYNC_LOCK, syncScheduler } from './syncScheduler';
import { syncStore } from './sync.svelte';
import { TEST_WORKSPACE } from '../../tests/workspace';

// A sync holds the sync lock for as long as the relay takes to answer. On a poor
// connection that is minutes, and a workspace handover only touches this device,
// so it must go ahead without the relay ever answering.

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
		if (!relay.answers) return;
		queueMicrotask(() => {
			this.status = 200;
			this.responseText = JSON.stringify(ROUND_DONE);
			this.onload?.();
			this.onloadend?.();
		});
	}
	abort(): void {
		this.aborted = true;
		this.onabort?.();
		this.onloadend?.();
	}
}

/** The sync lock as the browser grants it: one holder at a time, in request order. */
function serialLocks() {
	let chain: Promise<unknown> = Promise.resolve();
	return {
		request: <T>(name: string, ...rest: unknown[]): Promise<T> => {
			const run = rest.at(-1) as () => Promise<T>;
			// Only the sync lock is under test; the others are theirs to take.
			if (name !== SYNC_LOCK) return run();
			const held = chain.then(run);
			chain = held.catch(() => undefined);
			return held;
		}
	};
}

function workspace(id: string, synced: boolean, createdAt: number): StoredProfile {
	return { id, name: id, syncKey: synced ? createSyncIdentity().syncKey : '', createdAt };
}

async function open(target: StoredProfile, others: StoredProfile[]) {
	syncStore.profiles = [target, ...others];
	syncStore.activateProfile(target);
	await notesStore.reloadForProfile();
}

/** Start a sync and wait until its request is out and unanswered. */
async function syncAgainstSilentRelay(): Promise<{ flight: Promise<boolean> }> {
	relay.answers = false;
	const flight = notesStore.syncWithCloudManual();
	await vi.waitFor(() => expect(requests).toHaveLength(1));
	// Wrapped: returning the flight itself would wait for it.
	return { flight };
}

describe.each([
	['with Web Locks', true],
	['without Web Locks', false]
])('a handover while a sync waits on the relay, %s', (_name, webLocks) => {
	beforeEach(() => {
		requests = [];
		vi.stubGlobal('XMLHttpRequest', RelayXhr);
		if (webLocks) vi.stubGlobal('navigator', { ...navigator, locks: serialLocks() });
		vi.spyOn(
			syncStore as unknown as { accessToken(): Promise<string> },
			'accessToken'
		).mockResolvedValue('token');
	});

	afterEach(async () => {
		relay.answers = true;
		// A workspace left behind may still be waiting on the relay.
		syncScheduler.reset();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		syncStore.activateLocalWorkspace(TEST_WORKSPACE);
		syncStore.profiles = [];
		await notesStore.reloadForProfile();
		localStorage.clear();
	});

	it('switches workspace without the relay answering', async () => {
		const syncing = workspace('syncing', true, 1);
		const other = workspace('other', false, 2);
		await open(syncing, [other]);
		const { flight } = await syncAgainstSilentRelay();
		expect(notesStore.syncing).toBe(true);

		expect(await new ProfileCoordinator().switchTo(other.id)).toEqual({ success: true });

		expect(syncStore.activeId).toBe(other.id);
		expect(requests[0].aborted).toBe(true);
		// The workspace arrived in is not syncing, and nothing failed. The one left
		// behind goes on from its database, and whoever asked for its sync still waits.
		expect(notesStore.syncing).toBe(false);
		expect(syncScheduler.syncing(syncing.id)).toBe(true);
		let answered = false;
		void flight.then(() => (answered = true));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(answered).toBe(false);
		expect(syncStore.lastError).toBeNull();
		expect(notesStore.lastPersistError).toBeNull();
	});

	it('syncs the workspace arrived in, not the one a sync was still running for', async () => {
		const syncing = workspace('syncing', true, 1);
		const other = workspace('other-synced', true, 2);
		await open(syncing, [other]);
		const { flight: left } = await syncAgainstSilentRelay();
		const accounts: (string | undefined)[] = [];
		const sync = syncStore.sync.bind(syncStore);
		vi.spyOn(syncStore, 'sync').mockImplementation((...args) => {
			accounts.push(syncStore.account?.syncKey);
			return sync(...args);
		});

		relay.answers = true;
		expect(await new ProfileCoordinator().switchTo(other.id)).toEqual({ success: true });

		expect(await notesStore.reconcileWithCloud()).toBe(true);
		// The workspace left behind is settled from its database, after the open one.
		expect(await left).toBe(true);
		expect(accounts).toEqual([other.syncKey]);
		expect(requests[0].aborted).toBe(true);
		expect(requests.slice(1).some((request) => request.aborted)).toBe(false);
	});

	it('lets the sync go again after a handover that leaves its workspace open', async () => {
		const syncing = workspace('syncing', true, 1);
		const spare = workspace('spare', false, 2);
		await open(syncing, [spare]);
		const { flight } = await syncAgainstSilentRelay();
		const removeProfile = syncStore.removeProfile.bind(syncStore);
		let requestsBeforeRemoval = -1;
		vi.spyOn(syncStore, 'removeProfile').mockImplementation(async (id) => {
			const removal = await removeProfile(id);
			requestsBeforeRemoval = requests.length;
			return removal;
		});

		relay.answers = true;
		expect(await new ProfileCoordinator().remove(spare.id)).toEqual({ success: true });

		expect(requests[0].aborted).toBe(true);
		// The round goes again behind the handover, never during it.
		expect(requestsBeforeRemoval).toBe(1);
		// The same flight, so whoever waits on it gets the answer of the sync they asked for.
		expect(await flight).toBe(true);
		expect(syncStore.activeId).toBe(syncing.id);
		expect(requests.length).toBeGreaterThan(1);
		expect(syncStore.lastError).toBeNull();
		expect(notesStore.lastPersistError).toBeNull();
	});

	it('gives up its round for a handover in another window, then goes again', async () => {
		const syncing = workspace('syncing', true, 1);
		await open(syncing, []);
		const { flight } = await syncAgainstSilentRelay();
		const { channel } = syncScheduler as unknown as { channel: BroadcastChannel };

		relay.answers = true;
		channel.onmessage?.({ data: { type: 'handover' } } as MessageEvent);

		expect(requests[0].aborted).toBe(true);
		expect(await flight).toBe(true);
		expect(requests.length).toBeGreaterThan(1);
	});

	it('tells other windows that a handover wants the lock', async () => {
		const here = workspace('here', false, 1);
		const other = workspace('other', false, 2);
		await open(here, [other]);
		const postMessage = vi.fn();
		const store = syncScheduler as unknown as { channel: unknown };
		const channel = store.channel;
		store.channel = { postMessage };
		try {
			expect(await new ProfileCoordinator().switchTo(other.id)).toEqual({ success: true });
			expect(postMessage).toHaveBeenCalledWith({ type: 'handover' });
		} finally {
			store.channel = channel;
		}
	});
});
