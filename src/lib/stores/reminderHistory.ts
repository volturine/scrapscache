import { mergeWorkspaceState } from '$lib/db/idb';
import {
	isReminderHistoryEntry,
	mergeReminderEntries,
	mergeReminderHistory,
	readReminderHistory,
	REMINDER_HISTORY_STATE_KEY,
	type ReminderHistoryEntry
} from '$lib/reminderHistory';
import {
	channelState,
	REMINDER_CHANNEL_KEY,
	mergeEvents,
	eventNote,
	type ReminderChannelState,
	type ReminderEvent
} from '$lib/reminderChannel';
import { stableStringify } from '$lib/model/stableStringify';

type Listener = (entries: ReminderHistoryEntry[], pid: string) => void;
const entriesIn = (value: unknown): ReminderHistoryEntry[] =>
	Array.isArray(value) ? value.filter(isReminderHistoryEntry) : [];

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
	recordDismissed(pid: string, entry: { id: string; noteId: string }, at: number): void {
		const current = pid === this.pid ? this.entries.get(entry.id) : undefined;
		if (current?.dismissedAt !== undefined) return;
		this.record(pid, [{ ...entry, firedAt: current?.firedAt ?? at, dismissedAt: at }]);
	}
	private record(pid: string, entries: ReminderHistoryEntry[]): void {
		if (!pid) return;
		const updates = entries.filter(isReminderHistoryEntry).filter((entry) => {
			const current = pid === this.pid ? this.entries.get(entry.id) : undefined;
			return (
				!current ||
				stableStringify(current) !== stableStringify(mergeReminderEntries(current, entry))
			);
		});
		if (!updates.length) return;
		if (pid === this.pid) this.adopt(mergeReminderHistory(this.entries.values(), updates, {}), pid);
		else this.notify(updates, pid);
		this.enqueue(() =>
			this.commit(
				pid,
				updates.map((value) => ({ kind: 'handled', value })),
				true
			).then(() => {
				this.onPending?.(pid);
			})
		);
	}
	/** Note deletion removes its receipts through this channel, not the note-sync outbox. */
	forgetNotes(pid: string, tombstones: Record<string, number>): void {
		const events: ReminderEvent[] = Object.keys(tombstones).map((noteId) => ({
			kind: 'deleted',
			noteId
		}));
		if (!events.length) return;
		if (pid === this.pid)
			this.adopt(mergeReminderHistory(this.entries.values(), [], tombstones), pid);
		this.enqueue(() =>
			this.commit(pid, events, true).then(() => {
				this.onPending?.(pid);
			})
		);
	}
	waitForPendingWrites(): Promise<void> {
		return this.pendingWrites;
	}
	async prepare(pid: string, accountId: string): Promise<ReminderChannelState> {
		await this.pendingWrites;
		const state = await mergeWorkspaceState(
			pid,
			[REMINDER_HISTORY_STATE_KEY, REMINDER_CHANNEL_KEY],
			(current) => {
				const channel = channelState(current[REMINDER_CHANNEL_KEY]);
				if (channel.accountId === accountId) return { value: { [REMINDER_CHANNEL_KEY]: channel } };
				const pending = mergeEvents(
					channel.pending,
					entriesIn(current[REMINDER_HISTORY_STATE_KEY]).map((value) => ({
						kind: 'handled' as const,
						value
					})),
					Object.keys(channel.deletedNotes).map((noteId) => ({ kind: 'deleted' as const, noteId }))
				);
				return { value: { [REMINDER_CHANNEL_KEY]: { ...channel, accountId, cursor: 0, pending } } };
			}
		);
		return state[REMINDER_CHANNEL_KEY];
	}
	/** A relay reset rebuilds only receipt state, without touching note sync. */
	async resetChannel(pid: string, accountId: string): Promise<void> {
		await mergeWorkspaceState(
			pid,
			[REMINDER_CHANNEL_KEY, REMINDER_HISTORY_STATE_KEY],
			(current) => {
				const channel = channelState(current[REMINDER_CHANNEL_KEY]);
				if (channel.accountId !== accountId) return { value: current };
				const pending = mergeEvents(
					channel.pending,
					entriesIn(current[REMINDER_HISTORY_STATE_KEY]).map((value) => ({
						kind: 'handled' as const,
						value
					})),
					Object.keys(channel.deletedNotes).map((noteId) => ({ kind: 'deleted' as const, noteId }))
				);
				return { value: { [REMINDER_CHANNEL_KEY]: { ...channel, cursor: 0, pending } } };
			}
		);
	}

	async receive(
		pid: string,
		accountId: string,
		events: ReminderEvent[],
		acknowledged: ReminderEvent[],
		cursor: number
	): Promise<void> {
		await this.commit(pid, events, false, { accountId, acknowledged, cursor });
	}
	private async commit(
		pid: string,
		events: ReminderEvent[],
		local: boolean,
		received?: { accountId: string; acknowledged: ReminderEvent[]; cursor: number }
	): Promise<void> {
		const result = await mergeWorkspaceState(
			pid,
			[REMINDER_HISTORY_STATE_KEY, REMINDER_CHANNEL_KEY],
			(current) => {
				const channel = channelState(current[REMINDER_CHANNEL_KEY]);
				if (received && channel.accountId !== received.accountId) return { value: current };
				const deleted = { ...channel.deletedNotes };
				const newEvents: ReminderEvent[] = [];
				const stored = entriesIn(current[REMINDER_HISTORY_STATE_KEY]);
				for (const event of events) {
					if (event.kind === 'deleted') {
						if (!deleted[event.noteId]) newEvents.push(event);
						deleted[event.noteId] = 1;
					} else if (!deleted[event.value.noteId]) {
						const previous = stored.find((entry) => entry.id === event.value.id);
						if (
							!previous ||
							stableStringify(previous) !==
								stableStringify(mergeReminderEntries(previous, event.value))
						)
							newEvents.push(event);
					}
				}
				const entries = mergeReminderHistory(
					stored,
					events.flatMap((event) => (event.kind === 'handled' ? [event.value] : [])),
					deleted
				);
				const ack = new Set(received?.acknowledged.map((event) => stableStringify(event)) ?? []);
				const pending = mergeEvents(
					channel.pending.filter((event) => !ack.has(stableStringify(event))),
					local ? newEvents : []
				).filter((event) => event.kind === 'deleted' || !deleted[eventNote(event)]);
				return {
					value: {
						[REMINDER_HISTORY_STATE_KEY]: entries,
						[REMINDER_CHANNEL_KEY]: {
							...channel,
							deletedNotes: deleted,
							pending,
							cursor: received ? Math.max(channel.cursor, received.cursor) : channel.cursor
						}
					}
				};
			}
		);
		const deleted = channelState(result[REMINDER_CHANNEL_KEY]).deletedNotes;
		this.adopt(
			mergeReminderHistory(
				pid === this.pid ? this.entries.values() : [],
				entriesIn(result[REMINDER_HISTORY_STATE_KEY]),
				deleted
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
