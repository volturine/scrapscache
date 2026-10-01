import { tickAppClock } from '$lib/appClock.svelte';
import {
	addFiredReminderKeys,
	claimFiredReminderKey,
	getFiredReminderKeys,
	workspaceKey
} from '$lib/db/idb';
import {
	closeReminderNotifications,
	nextReminderAt,
	notificationPermission,
	relayReminderWakes,
	reminderPreview,
	reminderWakeId,
	showReminderNotification,
	unfiredDueReminders,
	type ReminderAlert,
	type ReminderNote,
	type ReminderWake
} from '$lib/reminderNotify';
import {
	fetchReminderWakes,
	publishReminderWakes,
	registerAllReminderDevices
} from '$lib/reminderWake';
import { readReminderHistory, type ReminderHistoryEntry } from '$lib/reminderHistory';
import { reminderHistoryStore, type ReminderHistoryStore } from '$lib/stores/reminderHistory';
import { syncStore } from '$lib/stores/sync.svelte';

const MAX_TIMER_MS = 60_000;
const FIRED_REMINDERS_MIRROR_KEY = 'scrapscache-fired-reminders-mirror';
/**
 * A reminder found this long after its time was missed here, so another device
 * may already have shown or dismissed it. It waits for this device to hear from
 * the cloud first.
 */
const ON_TIME_MS = 2 * 60_000;
const SYNC_CHANNEL = 'scrapscache-sync-channel';

/** What reminders need from the app shell. Every workspace on the device takes part. */
export type ReminderHost = {
	/** Every workspace on this device, and whether it syncs. */
	workspaces(): { id: string; linked: boolean }[];
	/** Reminder fields of a workspace that is not open. */
	loadNotes(pid: string): Promise<ReminderNote[]>;
	/** Exchange a workspace’s reminder receipts once; `receiptsSettled(pid)` follows either way. */
	reconcile(pid: string): void;
	/** Open a note in its own workspace, switching to it first if need be. */
	openNote(pid: string, noteId: string): void;
	/** Trigger cloud sync for a workspace so absent notes are downloaded. */
	triggerSync?(pid: string): void;
};

/** One workspace's reminders, as this window tracks them. */
type WorkspaceReminders = {
	pid: string;
	notes: ReminderNote[];
	/** Shown or handled here or on another device: never shown again. */
	fired: Set<string>;
	/** Already in the synced history, so the service worker's claims need not be recorded. */
	recorded: Set<string>;
	/** Found due by this window; the scan does not look at them twice. */
	seen: Set<string>;
	/** The relay will push these to this device, so the scan leaves them to the push. */
	armed: Set<string>;
	/** Active wakes known from the relay, including those whose notes are not synced yet. */
	remoteWakes: Map<string, ReminderWake>;
	/** When a receipt exchange last finished, whether or not it reached the cloud. */
	reconciledAt: number;
	reconcileRequested: boolean;
};

function firedReminderMirrorKey(pid: string): string {
	return workspaceKey(FIRED_REMINDERS_MIRROR_KEY, pid);
}

export function clearFiredReminderMirror(pid: string): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.removeItem(firedReminderMirrorKey(pid));
}

function readFiredReminderMirror(pid: string): string[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const stored: unknown = JSON.parse(localStorage.getItem(firedReminderMirrorKey(pid)) ?? '[]');
		return Array.isArray(stored)
			? stored.filter((item): item is string => typeof item === 'string')
			: [];
	} catch {
		return [];
	}
}

function writeFiredReminderMirror(pid: string, keys: Iterable<string>): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(firedReminderMirrorKey(pid), JSON.stringify([...keys]));
	} catch {
		/* IndexedDB remains the durable fallback when localStorage is unavailable. */
	}
}

function emptyWorkspace(pid: string): WorkspaceReminders {
	return {
		pid,
		notes: [],
		fired: new Set(),
		recorded: new Set(),
		seen: new Set(),
		armed: new Set(),
		remoteWakes: new Map(),
		reconciledAt: 0,
		reconcileRequested: false
	};
}

/**
 * Due reminders from every workspace on the device, open or not. Each keeps its
 * own ledger and history, so a reminder shown or dismissed anywhere is not shown
 * again, and opening one switches to its workspace.
 */
export class ReminderStore {
	alerts = $state<ReminderAlert[]>([]);
	host: ReminderHost | null = null;
	private workspaces = new Map<string, WorkspaceReminders>();
	private activePid = '';
	private activation: Promise<void> = Promise.resolve();
	private timer: ReturnType<typeof setTimeout> | null = null;
	private clock: ReturnType<typeof setInterval> | null = null;
	private channel: BroadcastChannel | null = null;
	private attached = false;
	private readonly history: ReminderHistoryStore;

	constructor(history: ReminderHistoryStore = reminderHistoryStore) {
		this.history = history;
		history.subscribe((entries, pid) => this.learn(entries, pid));
	}

	/** Settles once the open workspace's ledger is loaded. */
	whenReady(): Promise<void> {
		return this.activation;
	}

	/** The window moved to `pid`; every other workspace keeps being watched. */
	activateProfile(pid: string, notes: ReminderNote[]): Promise<void> {
		this.activePid = pid;
		this.activation = (async () => {
			const loaded = await this.loadWorkspace(pid, notes);
			if (pid !== this.activePid) return;
			this.workspaces.set(pid, loaded);
			this.scan();
			this.arm();
			void this.refreshOthers();
			if (this.linked(pid)) {
				void this.syncRemoteWakes(pid);
			}
		})();
		return this.activation;
	}

	/** A receipt exchange finished, whether or not it reached the cloud. */
	receiptsSettled(pid: string): void {
		const workspace = this.workspaces.get(pid);
		if (!workspace) return;
		workspace.reconciledAt = Date.now();
		workspace.reconcileRequested = false;
		this.scan();
		this.arm();
	}

	attach(host: ReminderHost): () => void {
		this.host = host;
		if (this.attached) return () => this.detach();
		this.attached = true;
		tickAppClock();
		void this.syncAllRemoteWakes();
		this.clock = setInterval(() => {
			tickAppClock();
			void this.syncAllRemoteWakes();
			this.scan();
			this.arm();
		}, 60_000);
		const onWake = () => {
			if (document.visibilityState === 'hidden') return;
			void this.refreshAll().then(() => {
				tickAppClock();
				void this.syncAllRemoteWakes();
				this.scan();
				this.arm();
				void registerAllReminderDevices();
			});
		};
		document.addEventListener('visibilitychange', onWake);
		window.addEventListener('focus', onWake);
		this.listenForNotificationClicks();
		// Another window syncing a workspace changes its notes and history here too.
		if (typeof BroadcastChannel !== 'undefined') {
			this.channel = new BroadcastChannel(SYNC_CHANNEL);
			this.channel.onmessage = (event) => {
				const pid = (event.data as { type?: string; pid?: unknown } | null)?.pid;
				if (typeof pid === 'string' && pid !== this.activePid) void this.refreshWorkspace(pid);
			};
		}
		void this.refreshOthers();
		void registerAllReminderDevices();
		return () => {
			document.removeEventListener('visibilitychange', onWake);
			window.removeEventListener('focus', onWake);
			this.detach();
		};
	}

	/** The open workspace's notes changed. */
	sync(notes: ReminderNote[]): void {
		const workspace = this.workspaces.get(this.activePid);
		if (!workspace) return;
		this.setNotes(workspace, notes);
		this.scan();
		this.arm();
	}

	/** Fetch remote wakes for one linked workspace. */
	async syncRemoteWakes(pid: string): Promise<void> {
		const profile = syncStore.profiles.find((p) => p.id === pid && p.syncKey);
		if (!profile) return;
		const remote = await fetchReminderWakes(profile);
		if (!remote) return;
		const workspace = this.workspaces.get(pid);
		if (!workspace) return;
		workspace.remoteWakes = new Map(remote.wakes.map((w) => [w.id, w]));
		this.scan();
		this.arm();
	}

	/** Fetch remote wakes for all linked workspaces on this device. */
	async syncAllRemoteWakes(): Promise<void> {
		const linked = this.host?.workspaces().filter((w) => w.linked) ?? [];
		await Promise.all(linked.map((w) => this.syncRemoteWakes(w.id)));
	}

	/** Publish only state that has completed cloud reconciliation. */
	publish(notes: ReminderNote[]): void {
		const pid = this.activePid;
		const candidateIds = new Set(relayReminderWakes(notes, Date.now()).map((wake) => wake.id));
		this.sync(notes);
		const registration =
			notificationPermission() === 'granted'
				? registerAllReminderDevices()
				: Promise.resolve(false);
		void Promise.all([publishReminderWakes(notes), registration])
			.then(([wakes, registered]) => {
				const workspace = this.workspaces.get(pid);
				if (!workspace) return;
				if (wakes && registered) {
					workspace.armed = new Set(wakes.map((wake) => wake.id));
					return;
				}
				this.resetArmed(workspace, candidateIds);
			})
			.catch(() => {
				const workspace = this.workspaces.get(pid);
				if (workspace) this.resetArmed(workspace, candidateIds);
			});
	}

	dismiss(wakeId: string): void {
		const alert = this.alerts.find((item) => item.wakeId === wakeId);
		if (alert) this.acknowledge(alert);
		this.alerts = this.alerts.filter((item) => item.wakeId !== wakeId);
	}

	open(wakeId: string): void {
		const alert = this.alerts.find((item) => item.wakeId === wakeId);
		this.dismiss(wakeId);
		if (alert) this.host?.openNote(alert.workspaceId, alert.noteId);
	}

	private resetArmed(workspace: WorkspaceReminders, candidateIds: Set<string>): void {
		workspace.armed = new Set();
		for (const id of candidateIds) workspace.seen.delete(id);
		this.scan();
	}

	private setNotes(workspace: WorkspaceReminders, notes: ReminderNote[]): void {
		workspace.notes = notes;
		const current = new Set(relayReminderWakes(notes, Date.now()).map((wake) => wake.id));
		for (const wakeId of workspace.remoteWakes.keys()) current.add(wakeId);
		workspace.seen = new Set([...workspace.seen].filter((id) => current.has(id)));
		workspace.armed = new Set([...workspace.armed].filter((id) => current.has(id)));
		for (const alert of this.alerts) {
			if (alert.workspaceId === workspace.pid && !alert.noteId) {
				const matching = notes.find(
					(item) =>
						item.reminder === alert.reminder &&
						reminderWakeId(item.id, alert.reminder) === alert.wakeId &&
						!item.archived &&
						!item.trashed
				);
				if (matching) {
					alert.noteId = matching.id;
					alert.title = reminderPreview(matching);
				}
			}
		}
		const kept = this.alerts.filter((alert) => {
			if (alert.workspaceId !== workspace.pid) return true;
			if (!alert.noteId) {
				const wake = workspace.remoteWakes.get(alert.wakeId);
				return wake != null && !workspace.fired.has(alert.wakeId);
			}
			const note = notes.find((item) => item.id === alert.noteId);
			return note != null && note.reminder === alert.reminder && !note.archived && !note.trashed;
		});
		if (kept.length !== this.alerts.length) this.alerts = kept;
	}

	/** Read a workspace's ledger and history before any of its reminders are scanned. */
	private async loadWorkspace(pid: string, notes: ReminderNote[]): Promise<WorkspaceReminders> {
		// A new object: a load that loses a race with a switch must not touch the live one.
		const previous = this.workspaces.get(pid) ?? emptyWorkspace(pid);
		const workspace: WorkspaceReminders = {
			...previous,
			seen: new Set(previous.seen),
			armed: new Set(previous.armed),
			remoteWakes: new Map(previous.remoteWakes)
		};
		const fired = new Set([...previous.fired, ...readFiredReminderMirror(pid)]);
		const recorded = new Set(previous.recorded);
		try {
			for (const key of await getFiredReminderKeys(pid)) fired.add(key);
			const history =
				this.history.activePid === pid
					? this.history.ids()
					: (await readReminderHistory(pid)).map((entry) => entry.id);
			for (const id of history) {
				fired.add(id);
				recorded.add(id);
			}
		} catch {
			/* IndexedDB may be unavailable in private browsing or tests. */
		}
		workspace.fired = fired;
		workspace.recorded = recorded;
		writeFiredReminderMirror(pid, fired);
		this.setNotes(workspace, notes);
		this.backfillHistory(workspace);
		return workspace;
	}

	/** Load a workspace that is not open, from its own database. */
	private async refreshWorkspace(pid: string): Promise<void> {
		const host = this.host;
		if (!host || pid === this.activePid) return;
		if (!host.workspaces().some((workspace) => workspace.id === pid)) return;
		const notes = await host.loadNotes(pid).catch(() => null);
		if (!notes || pid === this.activePid) return;
		const loaded = await this.loadWorkspace(pid, notes);
		if (pid === this.activePid) return;
		this.workspaces.set(pid, loaded);
		this.scan();
		this.arm();
		if (this.linked(pid)) {
			void this.syncRemoteWakes(pid);
		}
	}

	private async refreshOthers(): Promise<void> {
		const known = new Set(this.host?.workspaces().map((workspace) => workspace.id) ?? []);
		for (const pid of this.workspaces.keys()) {
			if (!known.has(pid) && pid !== this.activePid) this.forget(pid);
		}
		await Promise.all(
			[...known].filter((pid) => pid !== this.activePid).map((pid) => this.refreshWorkspace(pid))
		);
	}

	private async refreshAll(): Promise<void> {
		const active = this.workspaces.get(this.activePid);
		if (active) this.workspaces.set(active.pid, await this.loadWorkspace(active.pid, active.notes));
		await this.refreshOthers();
	}

	/** A workspace left this device: nothing of it is shown any more. */
	private forget(pid: string): void {
		this.workspaces.delete(pid);
		const kept = this.alerts.filter((alert) => alert.workspaceId !== pid);
		if (kept.length !== this.alerts.length) this.alerts = kept;
	}

	/** The user answered a reminder, so no device needs to show it again. */
	private acknowledge(
		alert: Pick<ReminderAlert, 'workspaceId' | 'wakeId' | 'noteId' | 'reminder'>
	): void {
		void this.claimFired(alert);
		this.history.recordDismissed(
			alert.workspaceId,
			{ id: alert.wakeId, noteId: alert.noteId, firedAt: alert.reminder },
			Date.now()
		);
	}

	/** Reminders recorded for a workspace: none of them is shown again here. */
	private learn(entries: ReminderHistoryEntry[], pid: string): void {
		const workspace = this.workspaces.get(pid);
		if (workspace) {
			for (const entry of entries) {
				workspace.fired.add(entry.id);
				workspace.recorded.add(entry.id);
			}
			writeFiredReminderMirror(pid, workspace.fired);
		}
		// The service worker reads the ledger when a push arrives with the app closed.
		void addFiredReminderKeys(
			pid,
			entries.map((entry) => entry.id)
		).catch(() => undefined);
		const dismissed = new Set(
			entries.filter((entry) => entry.dismissedAt !== undefined).map((entry) => entry.id)
		);
		if (!dismissed.size) return;
		const kept = this.alerts.filter(
			(alert) => alert.workspaceId !== pid || !dismissed.has(alert.wakeId)
		);
		if (kept.length !== this.alerts.length) this.alerts = kept;
		void closeReminderNotifications(dismissed);
	}

	/**
	 * The service worker claims reminders it shows while the app is closed. Once
	 * the app knows which note each belongs to, it records them so they sync.
	 */
	private backfillHistory(workspace: WorkspaceReminders): void {
		const now = Date.now();
		const fired: ReminderHistoryEntry[] = [];
		for (const note of workspace.notes) {
			if (note.reminder == null) continue;
			const id = reminderWakeId(note.id, note.reminder);
			if (!workspace.fired.has(id) || workspace.recorded.has(id)) continue;
			fired.push({ id, noteId: note.id, firedAt: note.reminder });
		}
		if (fired.length) this.history.recordFired(workspace.pid, fired);
	}

	private async addFallbackAlert(alert: ReminderAlert, alreadyClaimed = false): Promise<void> {
		if (!alreadyClaimed && !(await this.claimFired(alert))) return;
		if (!this.alerts.some((item) => item.wakeId === alert.wakeId)) {
			this.alerts = [...this.alerts, alert];
		}
	}

	scan(): void {
		const now = Date.now();
		for (const workspace of this.workspaces.values()) this.scanWorkspace(workspace, now);
	}

	private scanWorkspace(workspace: WorkspaceReminders, now: number): void {
		const due = unfiredDueReminders(workspace.notes, [...workspace.fired, ...workspace.seen], now);
		let waiting = false;
		for (const note of due) {
			const reminder = note.reminder as number;
			if (this.awaitsCloud(workspace, reminder, now)) {
				waiting = true;
				continue;
			}
			const wakeId = reminderWakeId(note.id, reminder);
			workspace.seen.add(wakeId);
			if (workspace.armed.has(wakeId)) continue;
			const alert: ReminderAlert = {
				workspaceId: workspace.pid,
				wakeId,
				noteId: note.id,
				reminder,
				title: reminderPreview(note)
			};
			if (notificationPermission() !== 'granted') {
				void this.addFallbackAlert(alert);
				continue;
			}
			void this.showSystemNotification(alert);
		}
		// Remote wakes for notes that have not synced to this device yet
		for (const wake of workspace.remoteWakes.values()) {
			if (wake.fireAt > now) continue;
			if (workspace.fired.has(wake.id) || workspace.seen.has(wake.id)) continue;
			const hasLocalNote = workspace.notes.some(
				(item) =>
					item.reminder === wake.fireAt &&
					reminderWakeId(item.id, wake.fireAt) === wake.id &&
					!item.archived &&
					!item.trashed
			);
			if (hasLocalNote) continue;
			workspace.seen.add(wake.id);
			if (workspace.armed.has(wake.id)) continue;
			const profile = syncStore.profiles.find((p) => p.id === workspace.pid);
			const workspaceName = profile?.name;
			const alert: ReminderAlert = {
				workspaceId: workspace.pid,
				wakeId: wake.id,
				noteId: '',
				reminder: wake.fireAt,
				title: workspaceName ? `Reminder (${workspaceName})` : 'Reminder'
			};
			if (notificationPermission() !== 'granted') {
				void this.addFallbackAlert(alert);
			} else {
				void this.showSystemNotification(alert);
			}
			if (this.host?.triggerSync) {
				this.host.triggerSync(workspace.pid);
			} else if (!workspace.reconcileRequested && this.host) {
				workspace.reconcileRequested = true;
				this.host.reconcile(workspace.pid);
			}
		}
		if (waiting && !workspace.reconcileRequested && this.host) {
			workspace.reconcileRequested = true;
			this.host.reconcile(workspace.pid);
		}
	}

	private linked(pid: string): boolean {
		return !!this.host?.workspaces().some((workspace) => workspace.id === pid && workspace.linked);
	}

	private awaitsCloud(workspace: WorkspaceReminders, reminder: number, now: number): boolean {
		return (
			reminder < now - ON_TIME_MS && workspace.reconciledAt < reminder && this.linked(workspace.pid)
		);
	}

	private async showSystemNotification(alert: ReminderAlert): Promise<void> {
		if (!(await this.claimFired(alert))) return;
		const shown = await showReminderNotification(alert, () => this.openFromNotification(alert));
		if (!shown) await this.addFallbackAlert(alert, true);
	}

	private openFromNotification(
		alert: Pick<ReminderAlert, 'workspaceId' | 'wakeId' | 'noteId' | 'reminder'>
	): void {
		this.acknowledge(alert);
		this.alerts = this.alerts.filter((item) => item.wakeId !== alert.wakeId);
		this.host?.openNote(alert.workspaceId, alert.noteId);
	}

	private arm(): void {
		if (this.timer != null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		const now = Date.now();
		let next: number | null = null;
		for (const workspace of this.workspaces.values()) {
			const at = nextReminderAt(workspace.notes, now);
			if (at != null && (next == null || at < next)) next = at;
			for (const wake of workspace.remoteWakes.values()) {
				if (wake.fireAt > now && !workspace.fired.has(wake.id)) {
					if (next == null || wake.fireAt < next) next = wake.fireAt;
				}
			}
		}
		if (next == null) return;
		const delay = Math.min(Math.max(next - now, 0), MAX_TIMER_MS);
		this.timer = setTimeout(() => {
			this.timer = null;
			tickAppClock();
			this.scan();
			this.arm();
		}, delay);
	}

	private async claimFired(
		alert: Pick<ReminderAlert, 'workspaceId' | 'wakeId' | 'noteId' | 'reminder'>
	): Promise<boolean> {
		const pid = alert.workspaceId;
		const workspace = this.workspaces.get(pid);
		if (workspace?.fired.has(alert.wakeId)) return false;
		if (workspace) {
			workspace.fired.add(alert.wakeId);
			writeFiredReminderMirror(pid, workspace.fired);
		}
		let claimed = true;
		try {
			claimed = await claimFiredReminderKey(pid, alert.wakeId);
		} catch {
			// Keep once-per-session behavior when IndexedDB is unavailable.
		}
		// If noteId is known, record in history. If the note hasn't synced yet,
		// backfillHistory will record it once the note arrives.
		if (alert.noteId) {
			this.history.recordFired(pid, [
				{ id: alert.wakeId, noteId: alert.noteId, firedAt: alert.reminder }
			]);
		}
		return claimed;
	}

	private onSwMessage = (event: MessageEvent) => {
		const data = event.data as {
			type?: string;
			noteId?: unknown;
			wakeId?: unknown;
			workspaceId?: unknown;
			reminder?: unknown;
		} | null;
		if (!data || typeof data.type !== 'string') return;
		const workspaceId = typeof data.workspaceId === 'string' ? data.workspaceId : this.activePid;
		if (data.type === 'reminder-wake') {
			if (typeof data.wakeId === 'string') {
				void this.syncRemoteWakes(workspaceId);
			}
			return;
		}
		if (data.type !== 'open-note') return;
		if (typeof data.noteId === 'string' && data.noteId) {
			if (typeof data.wakeId === 'string' && typeof data.reminder === 'number')
				this.openFromNotification({
					workspaceId,
					wakeId: data.wakeId,
					noteId: data.noteId,
					reminder: data.reminder
				});
			else this.host?.openNote(workspaceId, data.noteId);
		} else {
			if (typeof data.wakeId === 'string') {
				this.alerts = this.alerts.filter((item) => item.wakeId !== data.wakeId);
			}
			this.host?.openNote(workspaceId, '');
		}
	};

	private listenForNotificationClicks(): void {
		if (!('serviceWorker' in navigator)) return;
		navigator.serviceWorker.addEventListener('message', this.onSwMessage);
	}

	private detach(): void {
		this.attached = false;
		this.host = null;
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.removeEventListener('message', this.onSwMessage);
		}
		this.channel?.close();
		this.channel = null;
		if (this.timer != null) clearTimeout(this.timer);
		if (this.clock != null) clearInterval(this.clock);
		this.timer = null;
		this.clock = null;
	}
}

export const reminderStore = new ReminderStore();
