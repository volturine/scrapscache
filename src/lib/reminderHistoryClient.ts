import {
	REMINDER_BATCH_SIZE,
	openNoteReceipts,
	sealNoteReceipts,
	type ReminderPage
} from '#lib/reminderChannel.js';
import { reminderHistoryStore, type ReminderHistoryStore } from '#lib/stores/reminderHistory.js';
import { syncStore } from '#lib/stores/sync.svelte.js';
import { identityFromSyncKey } from '#lib/syncPairing.js';
import { isProfileReleased } from '#lib/db/idb.js';
import type { StoredProfile } from '#lib/profiles.js';

type Workspace = Pick<StoredProfile, 'id' | 'syncKey'>;
type Retry = { timer: ReturnType<typeof setTimeout> | null; backoff: number };

/** The relay's receipt storage for this account is full; retrying will not help until something changes. */
export class ReminderStorageFullError extends Error {}

/**
 * Independent of note-sync flights and their lock, cursor, outbox and status indicator.
 * Nothing stays connected and nothing polls: a workspace exchanges right after a
 * local receipt, before it shows a missed reminder, and when the app starts, is
 * shown again or comes back online. The open workspace then catches up; another
 * sends only what it has queued.
 */
export class ReminderHistoryClient {
	private flights = new Map<string, { syncKey: string; promise: Promise<void> }>();
	private again = new Set<string>();
	private attached = false;
	private retries = new Map<string, Retry>();
	constructor(
		private history: ReminderHistoryStore,
		private profiles: () => Workspace[],
		private activeId: () => string,
		private send: (profile: Workspace, body: string) => Promise<Response>
	) {}
	exchange(pid: string): Promise<void> {
		const current = this.profiles().find((profile) => profile.id === pid && profile.syncKey);
		if (!current) return Promise.resolve();
		// Capture identity: the keyring may be edited in place while a request is pending.
		const profile = { id: current.id, syncKey: current.syncKey };
		const pending = this.flights.get(pid);
		if (pending) {
			if (pending.syncKey !== profile.syncKey) {
				return pending.promise.catch(() => undefined).then(() => this.exchange(pid));
			}
			this.again.add(pid);
			return pending.promise;
		}
		const valid = () =>
			!isProfileReleased(pid) &&
			this.profiles().some((current) => current.id === pid && current.syncKey === profile.syncKey);
		const run = async () => {
			const accountId = identityFromSyncKey(profile.syncKey).accountId;
			do {
				this.again.delete(pid);
				let more = true;
				while (more && valid()) {
					const outbox = await this.history.prepare(pid, accountId);
					const notes = await Promise.all(
						outbox.notes.map((receipts) => sealNoteReceipts(profile.syncKey, receipts))
					);
					if (!valid()) return;
					const response = await this.send(
						profile,
						JSON.stringify({ cursor: outbox.cursor, notes })
					);
					if (response.status === 507) throw new ReminderStorageFullError();
					if (!response.ok) throw new Error('Reminder receipt delivery failed');
					const page = (await response.json()) as ReminderPage;
					if (page.reset === true) {
						if (outbox.cursor === 0) throw new Error('Invalid reminder receipt reset');
						if (!valid()) return;
						await this.history.resetChannel(pid, accountId);
						continue;
					}
					if (
						!Number.isSafeInteger(page.cursor) ||
						page.cursor < outbox.cursor ||
						!Array.isArray(page.notes) ||
						page.notes.length > REMINDER_BATCH_SIZE ||
						typeof page.hasMore !== 'boolean' ||
						(page.hasMore && page.cursor <= outbox.cursor)
					)
						throw new Error('Invalid reminder receipt page');
					const received = await Promise.all(
						page.notes.map((row) => openNoteReceipts(profile.syncKey, row))
					);
					if (!valid()) return;
					const answered = await this.history.receive(
						pid,
						accountId,
						received,
						outbox.sent,
						page.cursor
					);
					more = page.hasMore || outbox.more || answered;
				}
			} while (this.again.has(pid) && valid());
		};
		const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
		const flight = (
			locks?.request ? locks.request(`scrapscache-reminder-history:${pid}`, run) : run()
		).finally(() => {
			this.flights.delete(pid);
			this.again.delete(pid);
		});
		this.flights.set(pid, { syncKey: profile.syncKey, promise: flight });
		return flight;
	}
	private sendQueued(pid: string): void {
		void this.history
			.hasPending(pid)
			.then((pending) => {
				if (pending) this.requestExchange(pid);
			})
			.catch(() => undefined);
	}
	private requestExchange(pid: string): void {
		if (!this.attached) return;
		// A workspace removed or unlinked since stops retrying.
		if (!this.profiles().some((profile) => profile.id === pid && profile.syncKey)) {
			const stale = this.retries.get(pid);
			if (stale?.timer != null) clearTimeout(stale.timer);
			this.retries.delete(pid);
			return;
		}
		const retry = this.retries.get(pid) ?? { timer: null, backoff: 2000 };
		this.retries.set(pid, retry);
		if (retry.timer !== null) {
			clearTimeout(retry.timer);
			retry.timer = null;
		}
		void this.exchange(pid)
			.then(() => {
				if (this.retries.get(pid) !== retry) return;
				if (retry.timer !== null) clearTimeout(retry.timer);
				retry.timer = null;
				retry.backoff = 2000;
			})
			.catch((error: unknown) => {
				if (this.retries.get(pid) !== retry || retry.timer !== null) return;
				// A full relay stays full: the next receipt, focus or reconnect tries again.
				if (error instanceof ReminderStorageFullError) return;
				// Failure retries only. Successful idle streams never fetch on a timer.
				retry.timer = setTimeout(() => {
					retry.timer = null;
					this.requestExchange(pid);
				}, retry.backoff);
				retry.backoff = Math.min(retry.backoff * 2, 30_000);
			});
	}
	attach(): () => void {
		this.attached = true;
		let refreshedAt = -Infinity;
		// The open workspace catches up; another sends only what it has queued,
		// such as receipts the service worker recorded while the app was closed.
		const refresh = () => {
			// Focus and visibility often arrive together when the app comes back.
			if (Date.now() - refreshedAt < 1000) return;
			refreshedAt = Date.now();
			for (const profile of this.profiles()) {
				if (!profile.syncKey) continue;
				if (profile.id === this.activeId()) this.requestExchange(profile.id);
				else this.sendQueued(profile.id);
			}
		};
		const onVisible = () => {
			if (document.visibilityState === 'visible') refresh();
		};
		this.history.onPending = (pid) => this.requestExchange(pid);
		const onMessage = (event: MessageEvent) => {
			if (
				event.data?.type === 'reminder-history-pending' &&
				typeof event.data.workspaceId === 'string'
			)
				this.requestExchange(event.data.workspaceId);
		};
		navigator.serviceWorker?.addEventListener('message', onMessage);
		window.addEventListener('online', refresh);
		window.addEventListener('focus', refresh);
		document.addEventListener('visibilitychange', onVisible);
		refresh();
		return () => {
			this.attached = false;
			for (const retry of this.retries.values()) {
				if (retry.timer !== null) clearTimeout(retry.timer);
			}
			this.retries.clear();
			window.removeEventListener('online', refresh);
			window.removeEventListener('focus', refresh);
			document.removeEventListener('visibilitychange', onVisible);
			this.history.onPending = null;
			navigator.serviceWorker?.removeEventListener('message', onMessage);
		};
	}
}
export const reminderHistoryClient = new ReminderHistoryClient(
	reminderHistoryStore,
	() => syncStore.profiles,
	() => syncStore.activeId,
	(profile, body) =>
		syncStore.authorizedFetch(
			'/api/sync/reminders',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body,
				signal: AbortSignal.timeout(15_000)
			},
			identityFromSyncKey(profile.syncKey)
		)
);
