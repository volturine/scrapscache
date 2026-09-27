import {
	REMINDER_BATCH_SIZE,
	openReminderEvent,
	sealReminderEvent,
	type ReminderPage
} from '$lib/reminderChannel';
import { reminderHistoryStore, type ReminderHistoryStore } from '$lib/stores/reminderHistory';
import { syncStore } from '$lib/stores/sync.svelte';
import { identityFromSyncKey } from '$lib/syncPairing';
import { isProfileReleased } from '$lib/db/idb';
import type { StoredProfile } from '$lib/profiles';
import { SyncEventsClient } from '$lib/syncEventsClient';

type Workspace = Pick<StoredProfile, 'id' | 'syncKey'>;
type Watch = {
	syncKey: string;
	events: SyncEventsClient;
	retry: ReturnType<typeof setTimeout> | null;
	backoff: number;
};
/** Independent of note-sync flights and their lock, cursor, outbox and status indicator. */
export class ReminderHistoryClient {
	private flights = new Map<string, { syncKey: string; promise: Promise<void> }>();
	private again = new Set<string>();
	private attached = false;
	private watches = new Map<string, Watch>();
	constructor(
		private history: ReminderHistoryStore,
		private profiles: () => Workspace[],
		private send: (profile: Workspace, body: string) => Promise<Response>,
		private openEvents: (profile: Workspace, signal?: AbortSignal) => Promise<Response> = (
			profile,
			signal
		) =>
			syncStore.authorizedFetch(
				'/api/sync/reminders/events',
				{ signal },
				identityFromSyncKey(profile.syncKey)
			)
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
					const state = await this.history.prepare(pid, accountId);
					const sent = state.pending.slice(0, REMINDER_BATCH_SIZE);
					const events = await Promise.all(
						sent.map((event) => sealReminderEvent(profile.syncKey, event))
					);
					if (!valid()) return;
					const response = await this.send(
						profile,
						JSON.stringify({ cursor: state.cursor, events })
					);
					if (!response.ok) throw new Error('Reminder receipt delivery failed');
					const page = (await response.json()) as ReminderPage;
					if (page.reset === true) {
						if (state.cursor === 0) throw new Error('Invalid reminder receipt reset');
						if (!valid()) return;
						await this.history.resetChannel(pid, accountId);
						continue;
					}
					if (
						!Number.isSafeInteger(page.cursor) ||
						page.cursor < state.cursor ||
						!Array.isArray(page.events) ||
						page.events.length > REMINDER_BATCH_SIZE ||
						typeof page.hasMore !== 'boolean' ||
						(page.hasMore && page.cursor <= state.cursor)
					)
						throw new Error('Invalid reminder receipt page');
					const received = await Promise.all(
						page.events.map((event) => openReminderEvent(profile.syncKey, event))
					);
					if (!valid()) return;
					await this.history.receive(pid, accountId, received, sent, page.cursor);
					more = page.hasMore || state.pending.length > sent.length;
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
	/** Reconcile subscriptions when the keyring changes, including inactive workspaces. */
	updateProfiles(profiles: Workspace[] = this.profiles()): void {
		if (!this.attached) return;
		for (const [pid, watch] of this.watches) {
			if (profiles.some((profile) => profile.id === pid && profile.syncKey === watch.syncKey))
				continue;
			watch.events.destroy();
			if (watch.retry !== null) clearTimeout(watch.retry);
			this.watches.delete(pid);
		}
		for (const profile of profiles) {
			if (!profile.syncKey || this.watches.has(profile.id)) continue;
			const events = new SyncEventsClient(
				{
					get isLoggedIn() {
						return !!profile.syncKey;
					},
					authorizedFetch: (_url, init) => this.openEvents(profile, init?.signal ?? undefined)
				},
				undefined,
				{ path: '/api/sync/reminders/events', onConnected: () => this.requestExchange(profile.id) }
			);
			this.watches.set(profile.id, {
				syncKey: profile.syncKey,
				events,
				retry: null,
				backoff: 2000
			});
			events.subscribe(() => this.requestExchange(profile.id));
		}
	}
	private requestExchange(pid: string): void {
		const watch = this.watches.get(pid);
		if (!watch) return;
		if (watch.retry !== null) {
			clearTimeout(watch.retry);
			watch.retry = null;
		}
		void this.exchange(pid)
			.then(() => {
				if (this.watches.get(pid) !== watch) return;
				if (watch.retry !== null) clearTimeout(watch.retry);
				watch.retry = null;
				watch.backoff = 2000;
			})
			.catch(() => {
				if (this.watches.get(pid) !== watch || watch.retry !== null) return;
				// Failure retries only. Successful idle streams never fetch on a timer.
				watch.retry = setTimeout(() => {
					watch.retry = null;
					this.requestExchange(pid);
				}, watch.backoff);
				watch.backoff = Math.min(watch.backoff * 2, 30_000);
			});
	}
	attach(): () => void {
		this.attached = true;
		const refresh = () => {
			this.updateProfiles();
			for (const pid of this.watches.keys()) this.requestExchange(pid);
		};
		this.history.onPending = (pid) => {
			this.updateProfiles();
			this.requestExchange(pid);
		};
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
		this.updateProfiles();
		return () => {
			this.attached = false;
			for (const watch of this.watches.values()) {
				watch.events.destroy();
				if (watch.retry !== null) clearTimeout(watch.retry);
			}
			this.watches.clear();
			window.removeEventListener('online', refresh);
			window.removeEventListener('focus', refresh);
			this.history.onPending = null;
			navigator.serviceWorker?.removeEventListener('message', onMessage);
		};
	}
}
export const reminderHistoryClient = new ReminderHistoryClient(
	reminderHistoryStore,
	() => syncStore.profiles,
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
