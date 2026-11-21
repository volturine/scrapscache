// When a workspace syncs on this device, and who holds the sync lock, is decided
// here and nowhere else. The rules are the same for every workspace:
//
// 1. Each workspace has one lane, whether or not it is open in this window. A lane
//    is asked to sync, runs rounds under the lock until it has settled, and tells
//    everyone who asked meanwhile how it ended.
// 2. One round runs at a time. A handover (switching workspace, an import landing,
//    a pairing merge) goes first, then the open workspace, then the others in turn.
// 3. Whatever comes first interrupts what is running. Nothing is lost with a round:
//    what it had not committed is still queued, and its lane goes again.
// 4. A sync that could not reach the relay is tried again by itself, later each
//    time, for as long as the workspace has something to send. One the relay refused
//    waits until something changes.
// 5. The cloud icon turns while a round runs, whichever workspace it is for.
import { SvelteMap } from 'svelte/reactivity';
import { getSyncOutboxKeys, isProfileReleased } from '#lib/db/idb.js';
import { syncWorkspaceFromDevice } from '#lib/backgroundWorkspaceSync.js';
import type { StoredProfile } from '#lib/profiles.js';
import { backoffDelay, type Backoff } from '#lib/syncRetry.js';
import { syncStore, type SyncOutcome } from '#lib/stores/sync.svelte.js';

/** Web lock serializing sync rounds and handovers across every window of this origin. */
export const SYNC_LOCK = 'scrapscache-sync';

/** How long after the last change a workspace waits before it syncs. */
export const SYNC_AFTER_CHANGE_MS = 5_000;

/** How soon a workspace found owing the relay something gets its turn. */
const SYNC_OWING_MS = 2_000;

/** The relay could not be reached: from 5 seconds, doubling, at most 5 minutes. */
const unreachableRetry: Backoff = { base: 5_000, factor: 2, max: 300_000 };

/**
 * The least time between tries brought forward because another workspace's sync
 * got through: one that keeps failing is not tried after every sync.
 */
const REACHABLE_RETRY_GAP_MS = 30_000;

const SYNC_CHANNEL = 'scrapscache-sync-channel';

let lockQueue: Promise<unknown> = Promise.resolve();

/**
 * Run under the sync lock, in the order asked. An origin that is not secure has no
 * Web Locks; the order then still holds inside this window, which is what a
 * handover taking over from this window's own round relies on.
 */
function withSyncLock<T>(run: () => Promise<T>): Promise<T> {
	const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
	if (locks?.request) return locks.request(SYNC_LOCK, run);
	const held = lockQueue.then(run);
	lockQueue = held.catch(() => undefined);
	return held;
}

type Flight = {
	promise: Promise<boolean>;
	settle: (synced: boolean) => void;
	/** A round of it ran to its end: the rounds after it show no progress of their own. */
	shown: boolean;
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
};

/** How a round ended: as its sync did, or without one. */
type RoundEnd =
	| SyncOutcome
	/** Given up for something that comes first; the lane goes again. */
	| 'interrupted'
	/** Not open here and nothing to send: the relay was not contacted. */
	| 'idle'
	/** The workspace no longer syncs on this device. */
	| 'gone';

export class SyncScheduler {
	private lanes = new Map<string, Lane>();
	/** The lanes in flight, for the interface to read. */
	private flights = new SvelteMap<string, Promise<boolean>>();
	private running: { pid: string; round: AbortController } | null = null;
	/** The rounds being run, until no lane is asked any more. */
	private pumped: Promise<void> | null = null;
	private channel: BroadcastChannel | null = null;

	/** Syncs the workspace open in this window from what is in memory. Set by the notes store. */
	syncOpen: ((indicate: boolean, signal: AbortSignal) => Promise<SyncOutcome>) | null = null;
	/** Another window saved what it synced for this workspace. */
	onOtherWindowSynced: ((pid: string) => void) | null = null;

	constructor() {
		syncStore.onWorkspaceOwes = (pid) => this.changed(pid, SYNC_OWING_MS);
		if (typeof window === 'undefined') return;
		if ('BroadcastChannel' in window) {
			this.channel = new BroadcastChannel(SYNC_CHANNEL);
			this.channel.onmessage = (event) => {
				const type: unknown = event.data?.type;
				if (type === 'local-sync-complete' && typeof event.data?.pid === 'string')
					this.onOtherWindowSynced?.(event.data.pid);
				// Another window's handover is waiting for the lock a round here may hold.
				else if (type === 'handover') this.running?.round.abort();
				// Another window's open workspace comes before one that is not open here.
				else if (type === 'sync-waiting' && this.running && !this.isOpen(this.running.pid))
					this.running.round.abort();
			};
		}
		window.addEventListener('online', () => {
			// A request sent before the connection came back is not going to be answered
			// on the new one: the round is given up and its lane goes again.
			this.running?.round.abort();
			void this.request(syncStore.activePid);
			void this.scan();
		});
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState !== 'hidden') void this.scan();
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
		// The open workspace does not wait for one that is not open.
		if (this.isOpen(pid) && this.running && this.running.pid !== pid) this.running.round.abort();
		void this.pump();
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
	 * Run something that changes which data a sync would read, under the sync lock
	 * and without waiting for a sync to finish. A round holds the lock for as long as
	 * the relay takes to answer, and a handover only touches this device. So it asks
	 * for the lock first, which puts whatever asks later behind it, and then the
	 * round under way in any window is given up.
	 */
	handover<T>(run: () => Promise<T>): Promise<T> {
		const held = withSyncLock(run);
		this.running?.round.abort();
		this.post({ type: 'handover' });
		return held;
	}

	/**
	 * Give every workspace that is not open here and owes the relay something its
	 * turn, so what was written in a workspace is sent whether or not it is opened
	 * again. One that owes nothing is not contacted until it is opened.
	 */
	async scan(): Promise<void> {
		for (const profile of [...syncStore.profiles]) {
			const pid = profile.id;
			if (this.isOpen(pid) || !this.stored(pid) || this.lanes.get(pid)?.flight) continue;
			const keys = await this.queued(pid);
			if (keys.length > 0 && keys.join('\n') !== this.lanes.get(pid)?.leftover)
				this.changed(pid, SYNC_OWING_MS);
		}
	}

	/** Tell the other windows a workspace's database holds what was just saved. */
	announce(pid: string): void {
		this.post({ type: 'local-sync-complete', pid });
	}

	/**
	 * Forget every lane and what it had planned; settles once the round under way
	 * has given up. For tests, which share one scheduler.
	 */
	async reset(): Promise<void> {
		this.running?.round.abort();
		for (const [pid, lane] of this.lanes) {
			this.cancelTimer(lane);
			lane.asked = false;
			this.land(pid, lane, false);
		}
		this.lanes.clear();
		await this.pumped;
	}

	private isOpen(pid: string): boolean {
		return pid === syncStore.activePid;
	}

	/** The workspace as this device holds it without having it open, when it syncs. */
	private stored(pid: string): StoredProfile | null {
		if (this.isOpen(pid) || isProfileReleased(pid)) return null;
		return syncStore.profiles.find((entry) => entry.id === pid && entry.syncKey !== '') ?? null;
	}

	private syncs(pid: string): boolean {
		return this.isOpen(pid) ? syncStore.isLoggedIn : this.stored(pid) !== null;
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
				flight: null
			};
			this.lanes.set(pid, lane);
		}
		return lane;
	}

	private takeOff(pid: string): Flight {
		let settle: (synced: boolean) => void = () => undefined;
		const promise = new Promise<boolean>((resolve) => (settle = resolve));
		this.flights.set(pid, promise);
		return { promise, settle, shown: false };
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

	private post(message: { type: string; pid?: string }): void {
		try {
			this.channel?.postMessage(message);
		} catch {
			/* ignore BroadcastChannel error */
		}
	}

	private async queued(pid: string): Promise<string[]> {
		if (this.isOpen(pid)) await syncStore.waitForOutboxWrites();
		return (await getSyncOutboxKeys(pid).catch(() => [])).sort();
	}

	/** The lane whose turn it is: the open workspace's first, then the others. */
	private next(): string | null {
		let first: string | null = null;
		for (const [pid, lane] of this.lanes) {
			if (!lane.asked) continue;
			if (this.isOpen(pid)) return pid;
			first ??= pid;
		}
		return first;
	}

	/** Run the lanes that were asked, one round at a time, until none is. */
	private pump(): Promise<void> {
		if (this.pumped) return this.pumped;
		let done = false;
		const pumped = (async () => {
			try {
				for (let pid = this.next(); pid !== null; pid = this.next()) {
					await this.fly(pid).catch((err) => {
						// Whoever asked is answered, whatever went wrong in between.
						console.error('[sync] a sync round could not be settled', err);
						const lane = this.lanes.get(pid);
						if (!lane) return;
						lane.asked = false;
						this.land(pid, lane, false);
					});
				}
			} finally {
				// In the same step as the last look for a lane: an ask that arrives
				// after it starts the next pump instead of joining one that is over.
				done = true;
				this.pumped = null;
			}
		})();
		if (!done) this.pumped = pumped;
		return pumped;
	}

	/** One round of a lane, and what its end means for the lane. */
	private async fly(pid: string): Promise<void> {
		const lane = this.lane(pid);
		const flight = lane.flight;
		lane.asked = false;
		if (!flight) return;
		let before: string[] = [];
		let end: RoundEnd;
		// A workspace that is not open and owes nothing is not contacted until it is
		// opened: no lock is taken for it, and the cloud does not turn.
		if (!this.isOpen(pid) && (await this.queued(pid)).length === 0) end = 'idle';
		else {
			const round = new AbortController();
			this.running = { pid, round };
			lane.triedAt = Date.now();
			syncStore.onSyncStart?.();
			// Another window's round for a workspace that is not open there gives way too.
			if (this.isOpen(pid)) this.post({ type: 'sync-waiting' });
			try {
				end = await withSyncLock(async (): Promise<RoundEnd> => {
					// Decided under the lock: a handover that went first may have changed
					// which workspace is open, or taken this one off the device.
					if (round.signal.aborted) return 'interrupted';
					if (!this.syncs(pid)) return 'gone';
					before = await this.queued(pid);
					const outcome = await this.sync(pid, before, !flight.shown, round.signal);
					return round.signal.aborted ? 'interrupted' : outcome;
				});
			} catch (err) {
				end = round.signal.aborted ? 'interrupted' : 'failed';
				if (end === 'failed') console.error('[sync] a sync round failed', err);
			} finally {
				this.running = null;
				syncStore.onSyncEnd?.();
			}
		}

		if (end === 'interrupted') {
			lane.asked = true;
			return;
		}
		flight.shown = true;
		if (end === 'synced') {
			lane.syncedAt = Date.now();
			this.announce(pid);
			const after = await this.queued(pid);
			// Only what this sync had its chance at counts as left over. What was queued
			// while it ran has not been tried yet, and goes soon.
			const left = after.filter((key) => before.includes(key));
			lane.leftover = left.join('\n');
			if (after.length > left.length && !lane.timer && !lane.asked)
				this.wake(pid, lane, SYNC_OWING_MS);
			this.relayAnswered(pid);
		}
		if (end === 'synced' || end === 'idle') {
			lane.failures = 0;
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

	private sync(
		pid: string,
		queued: string[],
		indicate: boolean,
		signal: AbortSignal
	): Promise<SyncOutcome | 'idle'> {
		if (this.isOpen(pid))
			return this.syncOpen ? this.syncOpen(indicate, signal) : Promise.resolve('failed');
		const profile = this.stored(pid);
		// Another window may have sent it while this round waited for the lock.
		if (!profile || queued.length === 0) return Promise.resolve('idle');
		return syncWorkspaceFromDevice(profile, signal);
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
