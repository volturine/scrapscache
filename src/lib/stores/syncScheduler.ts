// When a workspace syncs on this device is decided here and nowhere else. The
// rules are the same for every workspace, and none of them depends on which
// workspace a window shows:
//
// 1. Every workspace syncs from its own database, in the background. What is
//    written on this device goes to the database straight away; a sync sends what
//    the database holds and saves what it pulled there.
// 2. Each workspace has one lane. A lane is asked to sync, runs rounds until it has
//    settled with the relay, and tells everyone who asked meanwhile how it ended.
//    One round of a workspace runs at a time, across windows. Workspaces do not
//    wait for each other, and none interrupts another.
// 3. Only something that rewrites a workspace (an import landing, replacing the cloud copy,
//    unlinking, deleting) interrupts its sync. Nothing is lost with the round: what
//    it had not committed is still queued, and the lane goes again.
// 4. A sync that could not reach the relay is tried again by itself, later each
//    time, for as long as the workspace has something to send. One the relay refused
//    waits until something changes.
// 5. Every workspace catches up with the relay at the same moments: when the app
//    starts, when it is shown again, when the connection comes back. What other
//    devices changed in a workspace is in its database before anyone opens it.
// 6. The cloud icon turns while a round runs, whichever workspace it is for.
import { SvelteMap } from 'svelte/reactivity';
import type { AttachmentDecisions } from '#lib/attachmentSettling.js';
import { getSyncOutboxKeys, isProfileReleased } from '#lib/db/idb.js';
import type { StoredProfile } from '#lib/profiles.js';
import { backoffDelay, type Backoff } from '#lib/syncRetry.js';
import type { SyncSnapshot } from '#lib/syncRecords.js';
import { withLock } from '#lib/webLock.js';
import { syncWorkspace } from '#lib/workspaceSync.js';
import { syncStore, type SyncOutcome } from '#lib/stores/sync.svelte.js';

/** Web lock, one per workspace, serializing its sync rounds and rewrites across every window. */
export const SYNC_LOCK = 'scrapscache-sync';

/** How long after the last change a workspace waits before it syncs. */
export const SYNC_AFTER_CHANGE_MS = 5_000;

/** How soon a workspace found owing the relay something gets its turn. */
const SYNC_OWING_MS = 2_000;

/**
 * A workspace that caught up with the relay this recently is not asked again by
 * the app starting or being shown: those arrive together, especially on iOS.
 */
export const CAUGHT_UP_MS = 30_000;

/** The relay could not be reached: from 5 seconds, doubling, at most 5 minutes. */
const unreachableRetry: Backoff = { base: 5_000, factor: 2, max: 300_000 };

/**
 * The least time between tries brought forward because another workspace's sync
 * got through: one that keeps failing is not tried after every sync.
 */
const REACHABLE_RETRY_GAP_MS = 30_000;

const SYNC_CHANNEL = 'scrapscache-sync-channel';

type Flight = {
	promise: Promise<boolean>;
	settle: (synced: boolean) => void;
};

type Lane = {
	/** A round is wanted and has not started. */
	asked: boolean;
	/** Asks by itself: once changes pause, or when a failed sync is due again. */
	timer: ReturnType<typeof setTimeout> | null;
	/** Syncs in a row that did not reach the relay. */
	failures: number;
	triedAt: number;
	syncedAt: number;
	/** What a sync that settled still left queued: not a reason to go again until it changes. */
	leftover: string;
	/** From the first ask until the lane has settled. */
	flight: Flight | null;
	/** The round that holds the workspace's lock or waits for it. */
	round: AbortController | null;
	/** The rewrites of the workspace started in this window that have not finished. */
	rewrites: Set<AbortController>;
	/** The rounds being run, until the lane is asked no more. */
	pumped: Promise<void> | null;
};

/** How a round ended: as its sync did, or without one. */
type RoundEnd =
	| SyncOutcome
	/** Given up for something that rewrites the workspace; the lane goes again. */
	| 'interrupted'
	/** The workspace no longer syncs on this device. */
	| 'gone';

export class SyncScheduler {
	private lanes = new Map<string, Lane>();
	/** The lanes in flight, for the interface to read. */
	private flights = new SvelteMap<string, Promise<boolean>>();
	private channel: BroadcastChannel | null = null;

	/**
	 * A sync saved into a workspace's database. A window showing that workspace shows
	 * what was saved: handed over when the sync ran here, read back when it ran in
	 * another window.
	 */
	onSynced:
		| ((pid: string, saved?: { snapshot: SyncSnapshot; decisions: AttachmentDecisions }) => unknown)
		| null = null;

	/** Another window rewrote a workspace's database whole. A window showing it loads it again. */
	onRewritten: ((pid: string) => unknown) | null = null;

	constructor() {
		syncStore.onWorkspaceOwes = (pid) => this.changed(pid, SYNC_OWING_MS);
		if (typeof window === 'undefined') return;
		if ('BroadcastChannel' in window) {
			this.channel = new BroadcastChannel(SYNC_CHANNEL);
			this.channel.onmessage = (event) => {
				const type: unknown = event.data?.type;
				const pid: unknown = event.data?.pid;
				if (typeof pid !== 'string') return;
				if (type === 'local-sync-complete') void this.onSynced?.(pid);
				else if (type === 'rewritten') void this.onRewritten?.(pid);
				// Another window is rewriting the workspace and waits for its lock.
				else if (type === 'rewrite') this.giveWay(this.lanes.get(pid));
			};
		}
		window.addEventListener('online', () => {
			// A request sent before the connection came back is not going to be answered
			// on the new one: the rounds are given up and their lanes go again.
			for (const lane of this.lanes.values()) lane.round?.abort();
			void this.catchUpAll(0);
		});
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState !== 'hidden') void this.catchUpAll();
		});
	}

	/** True from when a sync of this workspace is asked for until it has settled. */
	syncing(pid: string): boolean {
		return this.flights.has(pid);
	}

	/**
	 * Sync a workspace now. Whoever asks while it is under way shares its answer:
	 * true once the workspace is settled with the relay.
	 */
	request(pid: string): Promise<boolean> {
		if (!this.syncs(pid)) return Promise.resolve(false);
		const lane = this.lane(pid);
		this.cancelTimer(lane);
		lane.asked = true;
		lane.flight ??= this.takeOff(pid);
		const { promise } = lane.flight;
		void this.pump(pid, lane);
		return promise;
	}

	/**
	 * Something in a workspace changed and has to reach the relay: sync it once
	 * `delay` has passed without another change. A sync already under way goes one
	 * more round, since what it is sending may be behind by now.
	 */
	changed(pid: string, delay = SYNC_AFTER_CHANGE_MS): void {
		if (typeof window === 'undefined' || !this.syncs(pid)) return;
		const lane = this.lane(pid);
		if (lane.flight) lane.asked = true;
		this.wake(pid, lane, delay);
	}

	/**
	 * Catch up with the relay unless the workspace did so within the last `fresh`
	 * milliseconds. Joins a sync under way instead of asking for another round.
	 */
	catchUp(pid: string, fresh = 0): Promise<boolean> {
		if (!this.syncs(pid)) return Promise.resolve(false);
		const lane = this.lanes.get(pid);
		if (lane?.flight) return lane.flight.promise;
		if (lane && Date.now() - lane.syncedAt < fresh) return Promise.resolve(true);
		return this.request(pid);
	}

	/**
	 * Run something that rewrites a workspace or changes its key, without a sync of
	 * that workspace running beside it and without waiting for one to finish. A round
	 * holds the workspace's lock for as long as the relay takes to answer, so the
	 * lock is asked for first, which puts whatever asks later behind this, and then
	 * the round under way in any window is given up. A rewrite still running for
	 * the workspace gives way the same, when it listens to `signal`.
	 */
	rewrite<T>(pid: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const lane = this.lane(pid);
		const earlier = [...lane.rewrites];
		const mine = new AbortController();
		lane.rewrites.add(mine);
		const held = withLock(`${SYNC_LOCK}:${pid}`, () => run(mine.signal)).finally(() =>
			lane.rewrites.delete(mine)
		);
		lane.round?.abort();
		for (const rewrite of earlier) rewrite.abort();
		this.post({ type: 'rewrite', pid });
		return held;
	}

	/**
	 * Every workspace on this device catches up with the relay, shown or not: what
	 * was written in it is sent, and what other devices changed in it is saved into
	 * its database. One that did so within the last `fresh` milliseconds is left
	 * alone, unless something was queued in it since.
	 */
	async catchUpAll(fresh = CAUGHT_UP_MS): Promise<void> {
		for (const profile of [...syncStore.profiles]) {
			const pid = profile.id;
			const lane = this.lanes.get(pid);
			if (!this.profile(pid) || lane?.flight) continue;
			if (lane && Date.now() - lane.syncedAt < fresh) {
				const keys = await this.queued(pid);
				if (keys.length === 0 || keys.join('\n') === lane.leftover) continue;
			}
			// Joins a sync that was asked for while the queue was read.
			void this.catchUp(pid);
		}
	}

	/**
	 * Tell the other windows a workspace's database holds what was just saved: merged
	 * into it by a sync, or `rewritten` whole, which takes things away too.
	 */
	announce(pid: string, rewritten = false): void {
		this.post({ type: rewritten ? 'rewritten' : 'local-sync-complete', pid });
	}

	/**
	 * Forget every lane and what it had planned; settles once the rounds under way
	 * have given up. For tests, which share one scheduler.
	 */
	async reset(): Promise<void> {
		const pumped: Array<Promise<void> | null> = [];
		for (const [pid, lane] of this.lanes) {
			lane.round?.abort();
			this.cancelTimer(lane);
			lane.asked = false;
			this.land(pid, lane, false);
			pumped.push(lane.pumped);
		}
		this.lanes.clear();
		await Promise.all(pumped);
	}

	/** The workspace as this device holds it, when it syncs. */
	private profile(pid: string): StoredProfile | null {
		if (isProfileReleased(pid)) return null;
		return syncStore.profiles.find((entry) => entry.id === pid && entry.syncKey !== '') ?? null;
	}

	private syncs(pid: string): boolean {
		return this.profile(pid) !== null;
	}

	private lane(pid: string): Lane {
		let lane = this.lanes.get(pid);
		if (!lane) {
			lane = {
				asked: false,
				timer: null,
				failures: 0,
				triedAt: 0,
				syncedAt: 0,
				leftover: '',
				flight: null,
				round: null,
				rewrites: new Set(),
				pumped: null
			};
			this.lanes.set(pid, lane);
		}
		return lane;
	}

	private takeOff(pid: string): Flight {
		let settle: (synced: boolean) => void = () => undefined;
		const promise = new Promise<boolean>((resolve) => (settle = resolve));
		this.flights.set(pid, promise);
		return { promise, settle };
	}

	private land(pid: string, lane: Lane, synced: boolean): void {
		lane.flight?.settle(synced);
		lane.flight = null;
		this.flights.delete(pid);
	}

	private wake(pid: string, lane: Lane, delay: number): void {
		this.cancelTimer(lane);
		lane.timer = setTimeout(() => {
			lane.timer = null;
			void this.request(pid);
		}, delay);
	}

	private cancelTimer(lane: Lane): void {
		if (lane.timer) clearTimeout(lane.timer);
		lane.timer = null;
	}

	/** Whatever this window runs for a workspace lets go of its lock. */
	private giveWay(lane: Lane | undefined): void {
		lane?.round?.abort();
		for (const rewrite of lane?.rewrites ?? []) rewrite.abort();
	}

	private post(message: { type: string; pid: string }): void {
		try {
			this.channel?.postMessage(message);
		} catch {
			/* ignore BroadcastChannel error */
		}
	}

	private async queued(pid: string): Promise<string[]> {
		await syncStore.waitForOutboxWrites();
		return (await getSyncOutboxKeys(pid).catch(() => [])).sort();
	}

	/** Run the rounds a lane was asked for, one after the other, until it is asked no more. */
	private pump(pid: string, lane: Lane): Promise<void> {
		if (lane.pumped) return lane.pumped;
		let done = false;
		const pumped = (async () => {
			try {
				while (lane.asked && this.lanes.get(pid) === lane) {
					await this.fly(pid, lane).catch((err) => {
						// Whoever asked is answered, whatever went wrong in between.
						console.error('[sync] a sync round could not be settled', err);
						lane.asked = false;
						this.land(pid, lane, false);
					});
				}
			} finally {
				// In the same step as the last look at the lane: an ask that arrives
				// after it starts the next pump instead of joining one that is over.
				done = true;
				lane.pumped = null;
			}
		})();
		if (!done) lane.pumped = pumped;
		return pumped;
	}

	/** One round of a lane, and what its end means for the lane. */
	private async fly(pid: string, lane: Lane): Promise<void> {
		const flight = lane.flight;
		lane.asked = false;
		if (!flight) return;
		let before: string[] = [];
		let end: RoundEnd;
		const round = new AbortController();
		lane.round = round;
		lane.triedAt = Date.now();
		syncStore.onSyncStart?.();
		try {
			end = await withLock(`${SYNC_LOCK}:${pid}`, async (): Promise<RoundEnd> => {
				// Decided under the lock: a rewrite that went first may have taken the
				// workspace, or its key, off the device.
				if (round.signal.aborted) return 'interrupted';
				const profile = this.profile(pid);
				if (!profile) return 'gone';
				before = await this.queued(pid);
				const outcome = await syncWorkspace(profile, round.signal, async (snapshot, decisions) => {
					await this.onSynced?.(pid, { snapshot, decisions });
				});
				return round.signal.aborted ? 'interrupted' : outcome;
			});
		} catch (err) {
			end = round.signal.aborted ? 'interrupted' : 'failed';
			if (end === 'failed') console.error('[sync] a sync round failed', err);
		} finally {
			if (lane.round === round) lane.round = null;
			syncStore.onSyncEnd?.();
		}

		// Forgotten meanwhile: nobody is waiting on this lane any more.
		if (this.lanes.get(pid) !== lane) return;
		if (end === 'interrupted') {
			lane.asked = true;
			return;
		}
		if (end === 'synced') {
			lane.syncedAt = Date.now();
			lane.failures = 0;
			this.announce(pid);
			const after = await this.queued(pid);
			// Only what this sync had its chance at counts as left over. What was queued
			// while it ran has not been tried yet, and goes soon.
			const left = after.filter((key) => before.includes(key));
			lane.leftover = left.join('\n');
			if (after.length > left.length && !lane.timer && !lane.asked)
				this.wake(pid, lane, SYNC_OWING_MS);
			this.relayAnswered(pid);
			// Asked again while it ran: one more round before anyone is answered.
			if (!lane.asked) this.land(pid, lane, true);
			return;
		}
		// A round that failed is not sent again at once: a relay that did not answer
		// will not answer now, and whoever asked is told sooner.
		lane.asked = false;
		this.land(pid, lane, false);
		if (end === 'gone') {
			this.cancelTimer(lane);
			this.lanes.delete(pid);
		} else if (end === 'failed') {
			lane.failures += 1;
			if (!lane.timer && (await this.queued(pid)).length > 0)
				this.wake(pid, lane, backoffDelay(unreachableRetry, lane.failures - 1));
		}
	}

	/** The relay answered: a workspace waiting to try it again may go now. */
	private relayAnswered(pid: string): void {
		for (const [other, lane] of this.lanes) {
			if (other === pid || lane.failures === 0 || !lane.timer) continue;
			if (Date.now() - lane.triedAt >= REACHABLE_RETRY_GAP_MS) this.wake(other, lane, 0);
		}
	}
}

export const syncScheduler = new SyncScheduler();
