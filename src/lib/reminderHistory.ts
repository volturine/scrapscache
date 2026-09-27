// Which reminders a workspace has already shown or dismissed. It syncs, so a
// reminder handled on one device is not shown again on another.
import { getSyncState } from '$lib/db/idb';

export const REMINDER_HISTORY_STATE_KEY = 'scrapscache-reminder-history';

export type ReminderHistoryEntry = {
	/** Wake id: a hash of the note id and the reminder time. */
	id: string;
	noteId: string;
	/** When a device first showed it. */
	firedAt: number;
	/** When a device first dismissed it. */
	dismissedAt?: number;
};

const WAKE_ID = /^[A-Za-z0-9_-]{43}$/;

function time(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function isReminderHistoryEntry(value: unknown): value is ReminderHistoryEntry {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const entry = value as Partial<ReminderHistoryEntry>;
	return (
		typeof entry.id === 'string' &&
		WAKE_ID.test(entry.id) &&
		typeof entry.noteId === 'string' &&
		entry.noteId.length > 0 &&
		time(entry.firedAt) &&
		(entry.dismissedAt === undefined || time(entry.dismissedAt))
	);
}

function earliest(left?: number, right?: number): number | undefined {
	if (left === undefined) return right;
	if (right === undefined) return left;
	return Math.min(left, right);
}

/** Earliest time wins for each fact, so every device settles on the same entry. */
export function mergeReminderEntries(
	left: ReminderHistoryEntry,
	right: ReminderHistoryEntry
): ReminderHistoryEntry {
	const dismissedAt = earliest(left.dismissedAt, right.dismissedAt);
	return {
		id: left.id,
		noteId: left.noteId,
		firedAt: Math.min(left.firedAt, right.firedAt),
		...(dismissedAt !== undefined ? { dismissedAt } : {})
	};
}

/** Merge remote entries in, dropping every entry whose note was deleted for good. */
export function mergeReminderHistory(
	local: Iterable<ReminderHistoryEntry>,
	remote: Iterable<ReminderHistoryEntry>,
	noteTombstones: Record<string, number>
): ReminderHistoryEntry[] {
	const byId = new Map<string, ReminderHistoryEntry>();
	for (const entry of [...local, ...remote]) {
		if (!isReminderHistoryEntry(entry) || (Number(noteTombstones[entry.noteId]) || 0) > 0) continue;
		const current = byId.get(entry.id);
		byId.set(entry.id, current ? mergeReminderEntries(current, entry) : entry);
	}
	return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** A workspace's history as this device saved it, whether or not it is the open one. */
export async function readReminderHistory(pid: string): Promise<ReminderHistoryEntry[]> {
	const stored = await getSyncState<unknown>(pid, REMINDER_HISTORY_STATE_KEY);
	return Array.isArray(stored) ? stored.filter(isReminderHistoryEntry) : [];
}
