import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const device = vi.hoisted(() => ({
	sync: vi.fn<(profile: { id: string }, signal: AbortSignal) => Promise<string>>()
}));
vi.mock('#lib/backgroundWorkspaceSync.js', () => ({ syncWorkspaceFromDevice: device.sync }));

import { clearSyncOutbox, getSyncOutboxKeys, markSyncOutbox } from '#lib/db/idb.js';
import type { StoredProfile } from '#lib/profiles.js';
import { createSyncIdentity, randomOpaqueId } from '#lib/syncPairing.js';
import { syncStore, type SyncOutcome } from './sync.svelte';
import { syncScheduler } from './syncScheduler';
import { TEST_WORKSPACE } from '../../tests/workspace';

/** A sync that stays under way until it is answered, or given up. */
function pending() {
	let answer: (outcome: SyncOutcome) => void = () => undefined;
	const outcome = new Promise<SyncOutcome>((resolve) => (answer = resolve));
	return {
		answer,
		run: (signal: AbortSignal) => {
			signal.addEventListener('abort', () => answer('failed'), { once: true });
			return outcome;
		}
	};
}

function workspace(name: string): StoredProfile {
	return {
		id: `${name}-${randomOpaqueId()}`,
		name,
		syncKey: createSyncIdentity().syncKey,
		createdAt: 1
	};
}

describe('the sync scheduler', () => {
	let open: StoredProfile;
	let other: StoredProfile;
	let third: StoredProfile;
	/** The workspace of every round that started, in order. */
	let rounds: string[];
	let openSync: (signal: AbortSignal) => Promise<SyncOutcome>;
	const name = (pid: string) => [open, other, third].find((entry) => entry.id === pid)?.name;

	beforeEach(async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		open = workspace('open');
		other = workspace('other');
		third = workspace('third');
		syncStore.profiles = [open, other, third];
		syncStore.activateProfile(open);
		rounds = [];
		openSync = async () => 'synced';
		syncScheduler.syncOpen = (_indicate, signal) => {
			rounds.push('open');
			return openSync(signal);
		};
		device.sync.mockReset().mockImplementation(async (profile) => {
			rounds.push(name(profile.id) ?? '?');
			await clearSyncOutbox(profile.id, await getSyncOutboxKeys(profile.id));
			return 'synced';
		});
		for (const profile of [other, third]) await markSyncOutbox(profile.id, ['note:queued']);
	});

	afterEach(async () => {
		await syncScheduler.reset();
		syncScheduler.syncOpen = null;
		for (const profile of [open, other, third])
			await clearSyncOutbox(profile.id, await getSyncOutboxKeys(profile.id));
		syncStore.activateLocalWorkspace(TEST_WORKSPACE);
		syncStore.profiles = [];
		vi.restoreAllMocks();
	});

	it('runs one round at a time, the open workspace first and then the others', async () => {
		const first = pending();
		device.sync.mockImplementationOnce((profile, signal) => {
			rounds.push(name(profile.id) ?? '?');
			return first.run(signal);
		});
		const others = [syncScheduler.request(third.id), syncScheduler.request(other.id)];
		await vi.waitFor(() => expect(rounds).toEqual(['third']));

		// Asked while a workspace that is not open has the lock: it gives way.
		const opened = syncScheduler.request(open.id);

		expect(await opened).toBe(true);
		expect(await Promise.all(others)).toEqual([true, true]);
		expect(rounds).toEqual(['third', 'open', 'third', 'other']);
	});

	it('answers everyone who asked during a sync with one more round, and no more', async () => {
		const first = pending();
		openSync = (signal) => first.run(signal);
		const asked = syncScheduler.request(open.id);
		await vi.waitFor(() => expect(rounds).toEqual(['open']));
		openSync = async () => 'synced';

		const joined = [syncScheduler.request(open.id), syncScheduler.request(open.id)];
		syncScheduler.changed(open.id);
		expect(syncScheduler.syncing(open.id)).toBe(true);
		first.answer('synced');

		expect(await Promise.all([asked, ...joined])).toEqual([true, true, true]);
		expect(rounds).toEqual(['open', 'open']);
		expect(syncScheduler.syncing(open.id)).toBe(false);
	});

	it('lets a handover go first, and the sync it interrupted goes again behind it', async () => {
		const first = pending();
		openSync = (signal) => first.run(signal);
		const asked = syncScheduler.request(open.id);
		await vi.waitFor(() => expect(rounds).toEqual(['open']));
		openSync = async () => 'synced';

		const order: string[] = [];
		const handed = syncScheduler.handover(async () => {
			order.push(`handover after ${rounds.length} round`);
		});

		expect(await asked).toBe(true);
		await handed;
		expect(order).toEqual(['handover after 1 round']);
		expect(rounds).toEqual(['open', 'open']);
	});

	it('goes on from the database for a workspace that a handover closed', async () => {
		const first = pending();
		openSync = (signal) => first.run(signal);
		await markSyncOutbox(open.id, ['note:unsent']);
		const asked = syncScheduler.request(open.id);
		await vi.waitFor(() => expect(rounds).toEqual(['open']));

		await syncScheduler.handover(async () => syncStore.activateProfile(other));

		// The same ask is answered by the sync that sends it, though the workspace is closed.
		expect(await asked).toBe(true);
		expect(rounds).toEqual(['open', 'open']);
		expect(device.sync).toHaveBeenCalledOnce();
		expect(await getSyncOutboxKeys(open.id)).toEqual([]);
	});

	it('does not contact the relay for a workspace that is not open and owes nothing', async () => {
		await clearSyncOutbox(other.id, ['note:queued']);
		const turned = vi.fn();
		syncStore.onSyncStart = turned;
		try {
			expect(await syncScheduler.request(other.id)).toBe(true);
		} finally {
			syncStore.onSyncStart = null;
		}

		expect(device.sync).not.toHaveBeenCalled();
		expect(turned).not.toHaveBeenCalled();
	});

	it('does not sync a workspace that does not sync, or is no longer on the device', async () => {
		const local: StoredProfile = { id: 'local', name: 'Local', syncKey: '', createdAt: 1 };
		syncStore.profiles = [open, local];

		expect(await syncScheduler.request(local.id)).toBe(false);
		expect(await syncScheduler.request(other.id)).toBe(false);
		syncScheduler.changed(other.id, 0);
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(rounds).toEqual([]);
	});

	it('answers a failed sync at once, without another round for those who joined it', async () => {
		const first = pending();
		openSync = (signal) => first.run(signal);
		const asked = syncScheduler.request(open.id);
		await vi.waitFor(() => expect(rounds).toEqual(['open']));
		const joined = syncScheduler.request(open.id);

		first.answer('failed');

		expect(await Promise.all([asked, joined])).toEqual([false, false]);
		expect(rounds).toEqual(['open']);
	});

	it('joins a sync under way to catch up, and skips one when it has just synced', async () => {
		expect(await syncScheduler.catchUp(open.id, 30_000)).toBe(true);
		expect(await syncScheduler.catchUp(open.id, 30_000)).toBe(true);
		expect(rounds).toEqual(['open']);

		const first = pending();
		openSync = (signal) => first.run(signal);
		const asked = syncScheduler.request(open.id);
		await vi.waitFor(() => expect(rounds).toEqual(['open', 'open']));
		const caughtUp = syncScheduler.catchUp(open.id);
		first.answer('synced');

		expect(await Promise.all([asked, caughtUp])).toEqual([true, true]);
		expect(rounds).toEqual(['open', 'open']);
	});

	it('gives way to a handover and to an open workspace in another window', async () => {
		const first = pending();
		device.sync.mockImplementationOnce((profile, signal) => {
			rounds.push(name(profile.id) ?? '?');
			return first.run(signal);
		});
		const { channel } = syncScheduler as unknown as { channel: BroadcastChannel };
		const asked = syncScheduler.request(other.id);
		await vi.waitFor(() => expect(rounds).toEqual(['other']));

		channel.onmessage?.({ data: { type: 'sync-waiting' } } as MessageEvent);

		expect(await asked).toBe(true);
		expect(rounds).toEqual(['other', 'other']);
	});
});
