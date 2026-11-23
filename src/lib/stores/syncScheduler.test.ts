import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Saved = (snapshot: SyncSnapshot, decisions: AttachmentDecisions) => Promise<void>;

const driver = vi.hoisted(() => ({
	sync: vi.fn<(profile: { id: string }, signal: AbortSignal, saved: Saved) => Promise<string>>()
}));
vi.mock('#lib/workspaceSync.js', () => ({ syncWorkspace: driver.sync }));

import type { AttachmentDecisions } from '#lib/attachmentSettling.js';
import { clearSyncOutbox, getSyncOutboxKeys, markSyncOutbox } from '#lib/db/idb.js';
import type { StoredProfile } from '#lib/profiles.js';
import { createSyncIdentity, randomOpaqueId } from '#lib/syncPairing.js';
import { syncSnapshot, type SyncSnapshot } from '#lib/syncRecords.js';
import type { SyncOutcome } from '#lib/relaySync.js';
import { syncStore } from './sync.svelte';
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
	/** What a test listens to on the scheduler, let go of after it. */
	const listening: Array<() => void> = [];
	const name = (pid: string) => [open, other, third].find((entry) => entry.id === pid)?.name;
	/** The next round of a workspace stays under way until it is answered. */
	const hold = (profile: StoredProfile) => {
		const held = pending();
		const signals: AbortSignal[] = [];
		driver.sync.mockImplementationOnce((asked, signal) => {
			expect(asked.id).toBe(profile.id);
			rounds.push(profile.name);
			signals.push(signal);
			return held.run(signal);
		});
		return { answer: held.answer, interrupted: () => signals[0]?.aborted === true };
	};

	beforeEach(async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		open = workspace('open');
		other = workspace('other');
		third = workspace('third');
		syncStore.profiles = [open, other, third];
		syncStore.activateProfile(open);
		rounds = [];
		driver.sync.mockReset().mockImplementation(async (profile, signal) => {
			rounds.push(name(profile.id) ?? '?');
			if (!signal.aborted) await clearSyncOutbox(profile.id, await getSyncOutboxKeys(profile.id));
			return 'synced';
		});
		for (const profile of [other, third]) await markSyncOutbox(profile.id, ['note:queued']);
	});

	afterEach(async () => {
		await syncScheduler.reset();
		for (const stop of listening.splice(0)) stop();
		for (const profile of [open, other, third])
			await clearSyncOutbox(profile.id, await getSyncOutboxKeys(profile.id));
		syncStore.activateLocalWorkspace(TEST_WORKSPACE);
		syncStore.profiles = [];
		vi.restoreAllMocks();
	});

	it('syncs every workspace the same way, the open one and the others', async () => {
		expect(
			await Promise.all([syncScheduler.request(open.id), syncScheduler.request(other.id)])
		).toEqual([true, true]);

		expect(driver.sync.mock.calls.map(([profile]) => profile.id).sort()).toEqual(
			[open.id, other.id].sort()
		);
	});

	it('runs workspaces side by side: none waits for another, and none interrupts another', async () => {
		const slow = hold(other);
		const asked = syncScheduler.request(other.id);
		await vi.waitFor(() => expect(rounds).toEqual(['other']));

		// The open workspace syncs, start to end, while the other one is still uploading.
		expect(await syncScheduler.request(open.id)).toBe(true);
		expect(await syncScheduler.request(third.id)).toBe(true);

		expect(slow.interrupted()).toBe(false);
		expect(syncScheduler.syncing(other.id)).toBe(true);
		slow.answer('synced');
		expect(await asked).toBe(true);
		expect(rounds).toEqual(['other', 'open', 'third']);
	});

	it('leaves a sync alone when the window switches to another workspace', async () => {
		const leaving = hold(open);
		await markSyncOutbox(open.id, ['note:unsent']);
		const asked = syncScheduler.request(open.id);
		await vi.waitFor(() => expect(rounds).toEqual(['open']));

		syncStore.activateProfile(other);
		expect(await syncScheduler.request(other.id)).toBe(true);

		// The workspace that was left is still on its first and only round.
		expect(leaving.interrupted()).toBe(false);
		leaving.answer('synced');
		expect(await asked).toBe(true);
		expect(rounds).toEqual(['open', 'other']);
	});

	it('answers everyone who asked during a sync with one more round, and no more', async () => {
		const first = hold(open);
		const asked = syncScheduler.request(open.id);
		await vi.waitFor(() => expect(rounds).toEqual(['open']));

		const joined = [syncScheduler.request(open.id), syncScheduler.request(open.id)];
		syncScheduler.changed(open.id);
		expect(syncScheduler.syncing(open.id)).toBe(true);
		first.answer('synced');

		expect(await Promise.all([asked, ...joined])).toEqual([true, true, true]);
		expect(rounds).toEqual(['open', 'open']);
		expect(syncScheduler.syncing(open.id)).toBe(false);
	});

	it('lets a rewrite of the workspace go first, and the sync it interrupted goes again behind it', async () => {
		const first = hold(open);
		const asked = syncScheduler.request(open.id);
		await vi.waitFor(() => expect(rounds).toEqual(['open']));

		const order: string[] = [];
		const rewritten = syncScheduler.rewrite(open.id, async () => {
			order.push(`rewrite after ${rounds.length} round`);
		});

		expect(await asked).toBe(true);
		await rewritten;
		expect(first.interrupted()).toBe(true);
		expect(order).toEqual(['rewrite after 1 round']);
		expect(rounds).toEqual(['open', 'open']);
	});

	it('leaves the sync of every other workspace alone when one is rewritten', async () => {
		const slow = hold(other);
		const asked = syncScheduler.request(other.id);
		await vi.waitFor(() => expect(rounds).toEqual(['other']));

		await syncScheduler.rewrite(open.id, async () => undefined);

		expect(slow.interrupted()).toBe(false);
		slow.answer('synced');
		expect(await asked).toBe(true);
		expect(rounds).toEqual(['other']);
	});

	it('gives way to a rewrite of the workspace in another window', async () => {
		const first = hold(other);
		const { channel } = syncScheduler as unknown as { channel: BroadcastChannel };
		const asked = syncScheduler.request(other.id);
		await vi.waitFor(() => expect(rounds).toEqual(['other']));

		channel.onmessage?.({ data: { type: 'rewrite', pid: third.id } } as MessageEvent);
		expect(first.interrupted()).toBe(false);
		channel.onmessage?.({ data: { type: 'rewrite', pid: other.id } } as MessageEvent);

		expect(await asked).toBe(true);
		expect(rounds).toEqual(['other', 'other']);
	});

	it('gives up a rewrite still running when the next one comes for the same workspace', async () => {
		let given = false;
		const first = syncScheduler.rewrite(
			open.id,
			(signal) =>
				new Promise<string>((resolve) =>
					signal.addEventListener('abort', () => {
						given = true;
						resolve('first gave way');
					})
				)
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const second = syncScheduler.rewrite(open.id, async () => 'second ran');

		expect(await Promise.all([first, second])).toEqual(['first gave way', 'second ran']);
		expect(given).toBe(true);
	});

	it('hands what a sync saved to the window, and tells it when another window synced', async () => {
		const shown: Array<[string, boolean]> = [];
		listening.push(
			syncScheduler.whenSynced((pid, saved) => {
				shown.push([name(pid) ?? '?', saved !== undefined]);
			})
		);
		driver.sync.mockImplementationOnce(async (_profile, _signal, saved) => {
			await saved(syncSnapshot(), new Map());
			return 'synced';
		});
		const { channel } = syncScheduler as unknown as { channel: BroadcastChannel };

		expect(await syncScheduler.request(open.id)).toBe(true);
		channel.onmessage?.({ data: { type: 'local-sync-complete', pid: other.id } } as MessageEvent);

		expect(shown).toEqual([
			['open', true],
			['other', false]
		]);
	});

	it('tells everyone who listens, and nobody who stopped', async () => {
		const heard: string[] = [];
		const stop = syncScheduler.whenSynced(() => void heard.push('first'));
		listening.push(syncScheduler.whenSynced(() => void heard.push('second')));
		const { channel } = syncScheduler as unknown as { channel: BroadcastChannel };

		channel.onmessage?.({ data: { type: 'local-sync-complete', pid: open.id } } as MessageEvent);
		stop();
		channel.onmessage?.({ data: { type: 'local-sync-complete', pid: open.id } } as MessageEvent);

		expect(heard).toEqual(['first', 'second', 'second']);
	});

	it('is busy while any workspace syncs, whichever one a window shows', async () => {
		expect(syncScheduler.busy).toBe(false);
		const held = hold(other);
		const asked = syncScheduler.request(other.id);
		await vi.waitFor(() => expect(rounds).toEqual(['other']));

		expect(syncScheduler.busy).toBe(true);
		expect(syncScheduler.syncing(open.id)).toBe(false);

		held.answer('synced');
		await asked;
		expect(syncScheduler.busy).toBe(false);
	});

	it('tells the window when another window rewrote a workspace, apart from when it synced', async () => {
		const heard: string[] = [];
		listening.push(
			syncScheduler.whenSynced((pid) => void heard.push(`synced ${name(pid)}`)),
			syncScheduler.whenRewritten((pid) => void heard.push(`rewritten ${name(pid)}`))
		);
		const { channel } = syncScheduler as unknown as { channel: BroadcastChannel };

		channel.onmessage?.({ data: { type: 'rewritten', pid: other.id } } as MessageEvent);
		channel.onmessage?.({ data: { type: 'local-sync-complete', pid: open.id } } as MessageEvent);

		expect(heard).toEqual(['rewritten other', 'synced open']);
	});

	it('catches every workspace up, shown or not, with or without something to send', async () => {
		await clearSyncOutbox(other.id, ['note:queued']);
		const local: StoredProfile = { id: 'local', name: 'Local', syncKey: '', createdAt: 1 };
		syncStore.profiles = [open, other, third, local];

		syncScheduler.catchUpAll();
		await vi.waitFor(() => expect(rounds.slice().sort()).toEqual(['open', 'other', 'third']));
		await vi.waitFor(() =>
			expect([open, other, third].some(({ id }) => syncScheduler.syncing(id))).toBe(false)
		);

		// They have just caught up: the app being shown again asks nothing more,
		// and the connection coming back asks every one of them again.
		syncScheduler.catchUpAll();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(rounds).toHaveLength(3);
		window.dispatchEvent(new Event('online'));
		await vi.waitFor(() => expect(rounds).toHaveLength(6));
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
		const first = hold(open);
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

		const first = hold(open);
		const asked = syncScheduler.request(open.id);
		await vi.waitFor(() => expect(rounds).toEqual(['open', 'open']));
		const caughtUp = syncScheduler.catchUp(open.id);
		first.answer('synced');

		expect(await Promise.all([asked, caughtUp])).toEqual([true, true]);
		expect(rounds).toEqual(['open', 'open']);
	});

	it('still catches up after the device clock was set back', async () => {
		expect(await syncScheduler.catchUp(open.id)).toBe(true);
		expect(rounds).toEqual(['open']);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 3_600_000);
		try {
			// The last sync now looks like it lies an hour ahead: that is not "just now".
			expect(await syncScheduler.catchUp(open.id, 30_000)).toBe(true);
			expect(rounds).toEqual(['open', 'open']);
			expect(await syncScheduler.catchUp(open.id)).toBe(true);
			expect(rounds).toEqual(['open', 'open', 'open']);
		} finally {
			clock.mockRestore();
		}
	});

	it('syncs a workspace at once only when it has something to send', async () => {
		expect(await syncScheduler.flush(open.id)).toBe(false);
		expect(rounds).toEqual([]);

		expect(await syncScheduler.flush(other.id)).toBe(true);
		expect(rounds).toEqual(['other']);
	});

	it('syncs when the relay says a workspace changed, unless this device already has that', async () => {
		syncStore.syncedCursor = 7;

		expect(await syncScheduler.heard(open.id, 7)).toBe(true);
		expect(await syncScheduler.heard(open.id, 3)).toBe(true);
		expect(rounds).toEqual([]);

		expect(await syncScheduler.heard(open.id, 8)).toBe(true);
		// A connection that has just opened names no position: it always asks.
		expect(await syncScheduler.heard(open.id)).toBe(true);
		// What one workspace has says nothing of another.
		expect(await syncScheduler.heard(other.id, 7)).toBe(true);
		expect(rounds).toEqual(['open', 'open', 'other']);
	});

	describe('when the app is put away', () => {
		const show = (state: 'hidden' | 'visible') => {
			Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
			document.dispatchEvent(new Event('visibilitychange'));
		};

		afterEach(() => {
			Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		});

		it('sends what was waiting for changes to pause, in every workspace, at once', async () => {
			syncScheduler.changed(other.id);
			syncScheduler.changed(third.id);
			expect(rounds).toEqual([]);

			show('hidden');

			await vi.waitFor(() => expect([...rounds].sort()).toEqual(['other', 'third']));
			await vi.waitFor(() => expect(syncScheduler.syncing(other.id)).toBe(false));
			expect(await getSyncOutboxKeys(other.id)).toEqual([]);
		});

		it('sends it when the page is closed, too', async () => {
			syncScheduler.changed(other.id);

			window.dispatchEvent(new Event('pagehide'));

			await vi.waitFor(() => expect(rounds).toEqual(['other']));
		});

		it('tries a round again at once when it began before the app was shown again', async () => {
			await clearSyncOutbox(other.id, await getSyncOutboxKeys(other.id));
			const frozen = hold(other);
			const asked = syncScheduler.request(other.id);
			await vi.waitFor(() => expect(rounds).toEqual(['other']));
			show('hidden');
			await new Promise((resolve) => setTimeout(resolve, 5));

			show('visible');
			// The request the page was frozen with is given up by the browser.
			frozen.answer('failed');

			expect(await asked).toBe(false);
			// Nothing is queued in it, and it still catches up: its failure was the freeze's.
			// (Being shown again also has the other workspaces catch up.)
			await vi.waitFor(() =>
				expect(rounds.filter((round) => round === 'other')).toEqual(['other', 'other'])
			);
		});

		it('leaves a workspace alone that has nothing waiting, or waits to try the relay again', async () => {
			driver.sync.mockImplementationOnce(async (profile) => {
				rounds.push(name(profile.id) ?? '?');
				return 'failed';
			});
			expect(await syncScheduler.request(other.id)).toBe(false);
			expect(rounds).toEqual(['other']);

			show('hidden');
			await new Promise((resolve) => setTimeout(resolve, 20));

			// `other` waits for its next try, and nothing was asked of `open` or `third`.
			expect(rounds).toEqual(['other']);
		});
	});
});
