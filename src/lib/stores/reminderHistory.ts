import { mergeSyncStateWithOutbox } from '$lib/db/idb';
import {
	isReminderHistoryEntry,
	mergeReminderEntries,
	mergeReminderHistory,
	readReminderHistory,
	REMINDER_HISTORY_STATE_KEY,
	reminderHistoryKey,
	type ReminderHistoryEntry
} from '$lib/reminderHistory';
import { syncStore } from '$lib/stores/sync.svelte';
import { stableStringify } from '$lib/model/stableStringify';

type Listener = (entries: ReminderHistoryEntry[], pid: string) => void;

function storedEntries(value: unknown): ReminderHistoryEntry[] {
	return Array.isArray(value) ? value.filter(isReminderHistoryEntry) : [];
}

/**
 * Reminder history: what a workspace's devices have shown and dismissed. The open
 * workspace's history is held here for its sync; any workspace's can be recorded
 * to, straight to its own database. Every write merges into what is on disk, so
 * another window's entries are never written over.
 */
export class ReminderHistoryStore {
	private pid = '';
	private entries = new Map<string, ReminderHistoryEntry>();
	/** The open workspace's permanently deleted notes, whose history is dropped. */
	private noteTombstones: Record<string, number> = {};
	private generation = 0;
	private listeners = new Set<Listener>();
	private pendingWrites: Promise<void> = Promise.resolve();

	get activePid(): string {
		return this.pid;
	}

	/** Load a workspace's history. Nothing of the previous workspace's survives the switch. */
	async hydrate(pid: string): Promise<void> {
		const generation = ++this.generation;
		// What this window saved last must be on disk before it is read back.
		await this.pendingWrites;
		if (generation !== this.generation) return;
		this.pid = pid;
		this.entries = new Map();
		this.noteTombstones = {};
		const entries = await readReminderHistory(pid);
		if (generation !== this.generation) return;
		this.entries = new Map(entries.map((entry) => [entry.id, entry]));
		this.notify(entries, pid);
	}

	/** Listeners hear the entries that changed, with the workspace they belong to. */
	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** An entry of the open workspace. */
	get(id: string): ReminderHistoryEntry | undefined {
		return this.entries.get(id);
	}

	/** The open workspace's entries. */
	ids(): string[] {
		return [...this.entries.keys()];
	}

	recordFired(pid: string, fired: ReminderHistoryEntry[]): void {
		this.record(
			pid,
			pid === this.pid ? fired.filter((entry) => !this.entries.has(entry.id)) : fired
		);
	}

	/** Entries a backup brings back, dismissals included. */
	restore(pid: string, entries: ReminderHistoryEntry[]): void {
		this.record(pid, entries);
	}

	recordDismissed(pid: string, entry: { id: string; noteId: string }, at: number): void {
		const current = pid === this.pid ? this.entries.get(entry.id) : undefined;
		if (current?.dismissedAt !== undefined) return;
		this.record(pid, [{ ...entry, firedAt: current?.firedAt ?? at, dismissedAt: at }]);
	}

	/**
	 * History another device recorded for a workspace, learned without syncing it.
	 * It came from the relay, so nothing is queued to go back.
	 */
	learnRemote(
		pid: string,
		remote: ReminderHistoryEntry[],
		noteTombstones: Record<string, number>
	): void {
		if (pid === this.pid) {
			this.applySync(remote, { ...this.noteTombstones, ...noteTombstones });
			void this.persistSyncState(pid);
			return;
		}
		const entries = mergeReminderHistory([], remote, noteTombstones);
		if (!entries.length) return;
		this.write(pid, entries, [], noteTombstones);
		this.notify(entries, pid);
	}

	entriesForSync(): ReminderHistoryEntry[] {
		return [...this.entries.values()].map((entry) => ({ ...entry }));
	}

	/** Merge what a sync pulled without scheduling another upload. */
	applySync(remote: ReminderHistoryEntry[], noteTombstones: Record<string, number>): void {
		this.noteTombstones = { ...noteTombstones };
		this.adopt(mergeReminderHistory(this.entries.values(), remote, noteTombstones));
	}

	async persistSyncState(pid: string, syncOutboxKeys: Iterable<string> = []): Promise<void> {
		if (pid !== this.pid) return;
		this.write(pid, [...this.entries.values()], [...syncOutboxKeys], this.noteTombstones);
		await this.pendingWrites;
	}

	waitForPendingWrites(): Promise<void> {
		return this.pendingWrites;
	}

	private record(pid: string, updates: ReminderHistoryEntry[]): void {
		if (!pid) return;
		const valid = updates.filter(isReminderHistoryEntry);
		if (pid !== this.pid) {
			// A workspace that is not open: its database is the only copy here.
			if (!valid.length) return;
			this.write(pid, valid, valid.map(reminderHistoryKey), {});
			this.notify(valid, pid);
			return;
		}
		const changed: ReminderHistoryEntry[] = [];
		for (const update of valid) {
			const current = this.entries.get(update.id);
			const next = current ? mergeReminderEntries(current, update) : update;
			if (stableStringify(current) === stableStringify(next)) continue;
			this.entries.set(next.id, next);
			changed.push(next);
		}
		if (!changed.length) return;
		this.notify(changed, pid);
		this.write(
			pid,
			[...this.entries.values()],
			changed.map(reminderHistoryKey),
			this.noteTombstones
		);
		syncStore.requestAutoSync([]);
	}

	private write(
		pid: string,
		entries: ReminderHistoryEntry[],
		outboxKeys: string[],
		noteTombstones: Record<string, number>
	): void {
		const write = this.pendingWrites.then(async () => {
			const merged = await mergeSyncStateWithOutbox(pid, REMINDER_HISTORY_STATE_KEY, (current) => ({
				value: mergeReminderHistory(storedEntries(current), entries, noteTombstones),
				outboxKeys
			}));
			// Another window may have recorded something in between; adopt it.
			if (pid === this.pid) this.adopt(merged);
		});
		this.pendingWrites = write.catch((err) => {
			console.error('[reminders] could not save reminder history:', err);
		});
	}

	private adopt(merged: ReminderHistoryEntry[]): void {
		const changed = merged.filter(
			(entry) => stableStringify(this.entries.get(entry.id)) !== stableStringify(entry)
		);
		const kept = new Set(merged.map((entry) => entry.id));
		const dropped = [...this.entries.keys()].some((id) => !kept.has(id));
		if (!changed.length && !dropped) return;
		this.entries = new Map(merged.map((entry) => [entry.id, entry]));
		this.notify(changed, this.pid);
	}

	private notify(entries: ReminderHistoryEntry[], pid: string): void {
		if (!entries.length) return;
		for (const listener of this.listeners) listener(entries, pid);
	}
}

export const reminderHistoryStore = new ReminderHistoryStore();
