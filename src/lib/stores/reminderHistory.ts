import { getSyncState, mergeWorkspaceState } from '$lib/db/idb';
import {
	isReminderHistoryEntry,
	mergeReminderEntries,
	mergeReminderHistory,
	noteReceiptEntries,
	readReminderHistory,
	REMINDER_HISTORY_STATE_KEY,
	type ReminderHistoryEntry
} from '$lib/reminderHistory';
import {
	channelState,
	REMINDER_BATCH_SIZE,
	REMINDER_CHANNEL_KEY,
	eventNote,
	type NoteReceipts,
	type ReminderChannelState,
	type ReminderEvent
} from '$lib/reminderChannel';
import { stableStringify } from '$lib/model/stableStringify';

type Listener = (entries: ReminderHistoryEntry[], pid: string) => void;
const entriesIn = (value: unknown): ReminderHistoryEntry[] =>
	Array.isArray(value) ? value.filter(isReminderHistoryEntry) : [];
const same = (left: unknown, right: unknown) => stableStringify(left) === stableStringify(right);

/** Events queued before `ack` was read stay queued only if they are not in it. */
function withoutAcknowledged(pending: ReminderEvent[], ack: ReminderEvent[]): ReminderEvent[] {
	const sent = new Set(ack.map((event) => stableStringify(event)));
	return pending.filter((event) => !sent.has(stableStringify(event)));
}

/** Mark notes for upload, at most once each. */
function queueNotes(pending: ReminderEvent[], events: ReminderEvent[]): ReminderEvent[] {
	const queued = new Set(pending.map((event) => stableStringify(event)));
	const next = [...pending];
	for (const event of events) {
		const key = stableStringify(event);
		if (queued.has(key)) continue;
		queued.add(key);
		next.push(event);
	}
	return next;
}

/** Every note with receipts, marked once, to rebuild the relay's copy. */
function everyNote(entries: ReminderHistoryEntry[]): ReminderEvent[] {
	const byNote = new Map<string, ReminderHistoryEntry>();
	for (const entry of entries) byNote.set(entry.noteId, entry);
	return [...byNote.values()].map((value) => ({ kind: 'handled', value }));
}

export type ReminderOutbox = {
	cursor: number;
	/** Rows to upload now, one per note. */
	notes: NoteReceipts[];
	/** The queued events those rows answer. */
	sent: ReminderEvent[];
	/** More notes are queued than one upload carries. */
	more: boolean;
};

/** Independent durable reminder receipts. Never writes the note-sync outbox. */
export class ReminderHistoryStore {
	private pid = '';
	private entries = new Map<string, ReminderHistoryEntry>();
	private generation = 0;
	private listeners = new Set<Listener>();
	private pendingWrites: Promise<void> = Promise.resolve();
	onPending: ((pid: string) => void) | null = null;
	get activePid(): string {
		return this.pid;
	}
	async hydrate(pid: string): Promise<void> {
		const generation = ++this.generation;
		await this.pendingWrites;
		if (generation !== this.generation) return;
		this.pid = pid;
		const entries = await readReminderHistory(pid);
		if (generation !== this.generation) return;
		this.entries = new Map(entries.map((entry) => [entry.id, entry]));
		this.notify(entries, pid);
	}
	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	get(id: string): ReminderHistoryEntry | undefined {
		return this.entries.get(id);
	}
	ids(): string[] {
		return [...this.entries.keys()];
	}
	entriesForBackup(): ReminderHistoryEntry[] {
		return [...this.entries.values()].map((entry) => ({ ...entry }));
	}
	recordFired(pid: string, entries: ReminderHistoryEntry[]): void {
		this.record(
			pid,
			pid === this.pid ? entries.filter((entry) => !this.entries.has(entry.id)) : entries
		);
	}
	restore(pid: string, entries: ReminderHistoryEntry[]): void {
		this.record(pid, entries);
	}
	recordDismissed(pid: string, entry: ReminderHistoryEntry, at: number): void {
		const current = pid === this.pid ? this.entries.get(entry.id) : undefined;
		if (current?.dismissedAt !== undefined) return;
		this.record(pid, [{ ...entry, dismissedAt: at }]);
	}
	private record(pid: string, entries: ReminderHistoryEntry[]): void {
		if (!pid) return;
		const updates = entries.filter(isReminderHistoryEntry).filter((entry) => {
			const current = pid === this.pid ? this.entries.get(entry.id) : undefined;
			return !current || !same(current, mergeReminderEntries(current, entry));
		});
		if (!updates.length) return;
		if (pid === this.pid) this.adopt(mergeReminderHistory(this.entries.values(), updates, {}), pid);
		else this.notify(updates, pid);
		this.enqueue(async () => {
			if (await this.commitLocal(pid, updates, {})) this.onPending?.(pid);
		});
	}
	/**
	 * Note deletion removes its receipts through this channel, not the note-sync
	 * outbox. Only a note that had receipts needs the relay told; every deleted
	 * note is remembered so its receipts are not kept or sent again.
	 */
	forgetNotes(pid: string, tombstones: Record<string, number>): void {
		if (!Object.keys(tombstones).length) return;
		if (pid === this.pid)
			this.adopt(mergeReminderHistory(this.entries.values(), [], tombstones), pid);
		this.enqueue(async () => {
			if (await this.commitLocal(pid, [], tombstones)) this.onPending?.(pid);
		});
	}
	waitForPendingWrites(): Promise<void> {
		return this.pendingWrites;
	}
	/** Whether the workspace has receipts or deletions waiting to be sent. */
	async hasPending(pid: string): Promise<boolean> {
		await this.pendingWrites;
		return channelState(await getSyncState(pid, REMINDER_CHANNEL_KEY)).pending.length > 0;
	}
	/** The next upload for `accountId`, starting over when the workspace changed account. */
	async prepare(pid: string, accountId: string): Promise<ReminderOutbox> {
		await this.pendingWrites;
		let channel!: ReminderChannelState;
		let stored: ReminderHistoryEntry[] = [];
		await mergeWorkspaceState<Record<string, unknown>>(
			pid,
			[REMINDER_HISTORY_STATE_KEY, REMINDER_CHANNEL_KEY],
			(current) => {
				channel = channelState(current[REMINDER_CHANNEL_KEY]);
				stored = entriesIn(current[REMINDER_HISTORY_STATE_KEY]);
				if (channel.accountId === accountId) return { value: {} };
				// A new account holds nothing yet: send every note's receipts. Deletions
				// need no marker there, since it never had those notes' receipts.
				channel = {
					...channel,
					accountId,
					cursor: 0,
					pending: queueNotes(
						channel.pending.filter((event) => event.kind === 'handled'),
						everyNote(stored)
					)
				};
				return { value: { [REMINDER_CHANNEL_KEY]: channel } };
			}
		);
		const notes: NoteReceipts[] = [];
		const sent: ReminderEvent[] = [];
		const byNote = new Map<string, ReminderEvent[]>();
		for (const event of channel.pending) {
			byNote.set(eventNote(event), [...(byNote.get(eventNote(event)) ?? []), event]);
		}
		for (const [noteId, events] of [...byNote].slice(0, REMINDER_BATCH_SIZE)) {
			sent.push(...events);
			if (channel.deletedNotes[noteId]) {
				notes.push({ kind: 'deleted', noteId });
				continue;
			}
			const entries = noteReceiptEntries(stored, noteId);
			if (entries.length) notes.push({ kind: 'handled', noteId, entries });
		}
		return { cursor: channel.cursor, notes, sent, more: byNote.size > REMINDER_BATCH_SIZE };
	}
	/** A relay reset rebuilds only receipt state, without touching note sync. */
	async resetChannel(pid: string, accountId: string): Promise<void> {
		await mergeWorkspaceState<Record<string, unknown>>(
			pid,
			[REMINDER_CHANNEL_KEY, REMINDER_HISTORY_STATE_KEY],
			(current) => {
				const channel = channelState(current[REMINDER_CHANNEL_KEY]);
				if (channel.accountId !== accountId) return { value: {} };
				const pending = queueNotes(
					channel.pending,
					everyNote(entriesIn(current[REMINDER_HISTORY_STATE_KEY]))
				);
				return { value: { [REMINDER_CHANNEL_KEY]: { ...channel, cursor: 0, pending } } };
			}
		);
	}

	/**
	 * Apply rows downloaded for `accountId`. A row missing something this device
	 * knows is queued again with it merged in, and a row for a note deleted here
	 * is answered with a deletion, so every device and the relay converge. Says
	 * whether any answer was queued.
	 */
	async receive(
		pid: string,
		accountId: string,
		rows: NoteReceipts[],
		acknowledged: ReminderEvent[],
		cursor: number
	): Promise<boolean> {
		let answered = false;
		let result: { entries: ReminderHistoryEntry[]; deleted: Record<string, number> } | null = null;
		await mergeWorkspaceState<Record<string, unknown>>(
			pid,
			[REMINDER_HISTORY_STATE_KEY, REMINDER_CHANNEL_KEY],
			(current) => {
				const channel = channelState(current[REMINDER_CHANNEL_KEY]);
				if (channel.accountId !== accountId) return { value: {} };
				const deleted = { ...channel.deletedNotes };
				const stored = entriesIn(current[REMINDER_HISTORY_STATE_KEY]);
				for (const row of rows) if (row.kind === 'deleted') deleted[row.noteId] = 1;
				const entries = mergeReminderHistory(
					stored,
					rows.flatMap((row) => (row.kind === 'handled' ? row.entries : [])),
					deleted
				);
				const answers: ReminderEvent[] = [];
				for (const row of rows) {
					if (row.kind === 'deleted') continue;
					if (channel.deletedNotes[row.noteId]) {
						answers.push({ kind: 'deleted', noteId: row.noteId });
						continue;
					}
					const merged = noteReceiptEntries(entries, row.noteId);
					if (!same(merged, noteReceiptEntries(row.entries, row.noteId)))
						answers.push({ kind: 'handled', value: merged[0] });
				}
				const pending = queueNotes(
					withoutAcknowledged(channel.pending, acknowledged),
					answers
				).filter((event) => event.kind === 'deleted' || !deleted[eventNote(event)]);
				answered = answers.length > 0;
				result = { entries, deleted };
				return {
					value: {
						[REMINDER_HISTORY_STATE_KEY]: entries,
						[REMINDER_CHANNEL_KEY]: {
							...channel,
							deletedNotes: deleted,
							pending,
							cursor: Math.max(channel.cursor, cursor)
						}
					}
				};
			}
		);
		if (result) this.adoptStored(pid, result);
		return answered;
	}
	/** Record local receipts and deletions; says whether anything new was queued. */
	private async commitLocal(
		pid: string,
		updates: ReminderHistoryEntry[],
		tombstones: Record<string, number>
	): Promise<boolean> {
		let queued = false;
		let result: { entries: ReminderHistoryEntry[]; deleted: Record<string, number> } | null = null;
		await mergeWorkspaceState<Record<string, unknown>>(
			pid,
			[REMINDER_HISTORY_STATE_KEY, REMINDER_CHANNEL_KEY],
			(current) => {
				const channel = channelState(current[REMINDER_CHANNEL_KEY]);
				const stored = entriesIn(current[REMINDER_HISTORY_STATE_KEY]);
				const newlyDeleted = Object.keys(tombstones).filter(
					(noteId) => !channel.deletedNotes[noteId]
				);
				const fresh = updates.filter((entry) => {
					if (channel.deletedNotes[entry.noteId] || tombstones[entry.noteId]) return false;
					const previous = stored.find((item) => item.id === entry.id);
					return !previous || !same(previous, mergeReminderEntries(previous, entry));
				});
				if (!fresh.length && !newlyDeleted.length) return { value: {} };
				const deleted = { ...channel.deletedNotes };
				for (const noteId of newlyDeleted) deleted[noteId] = 1;
				const known = new Set([
					...stored.map((entry) => entry.noteId),
					...channel.pending.map(eventNote)
				]);
				const events: ReminderEvent[] = [
					...newlyDeleted
						.filter((noteId) => known.has(noteId))
						.map((noteId): ReminderEvent => ({ kind: 'deleted', noteId })),
					...fresh.map((value): ReminderEvent => ({ kind: 'handled', value }))
				];
				const entries = mergeReminderHistory(stored, fresh, deleted);
				const pending = queueNotes(
					channel.pending.filter((event) => event.kind === 'deleted' || !deleted[eventNote(event)]),
					events
				);
				queued = events.length > 0;
				result = { entries, deleted };
				return {
					value: {
						[REMINDER_HISTORY_STATE_KEY]: entries,
						[REMINDER_CHANNEL_KEY]: { ...channel, deletedNotes: deleted, pending }
					}
				};
			}
		);
		if (result) this.adoptStored(pid, result);
		return queued;
	}
	private adoptStored(
		pid: string,
		result: { entries: ReminderHistoryEntry[]; deleted: Record<string, number> }
	): void {
		this.adopt(
			mergeReminderHistory(
				pid === this.pid ? this.entries.values() : [],
				result.entries,
				result.deleted
			),
			pid
		);
	}
	private enqueue(run: () => Promise<void>): void {
		this.pendingWrites = this.pendingWrites.then(run).catch(() => {
			// No payloads or note identifiers in logs.
			console.error('[reminders] could not persist reminder receipts');
		});
	}
	private adopt(entries: ReminderHistoryEntry[], pid: string): void {
		if (pid === this.pid) {
			// Preserve immediate UI changes whose writes are still queued.
			this.entries = new Map(entries.map((entry) => [entry.id, entry]));
		}
		this.notify(entries, pid);
	}
	private notify(entries: ReminderHistoryEntry[], pid: string): void {
		for (const listener of this.listeners) listener(entries, pid);
	}
}
export const reminderHistoryStore = new ReminderHistoryStore();
