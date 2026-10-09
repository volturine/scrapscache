// Reminder receipts have their own encrypted transport, cursor and durable queue.
// The relay keeps one sealed row per note: what is known of that note's latest
// receipts. A new upload replaces the row, so storage follows the number of notes
// with reminders, not how often they fire.
import { sha256 } from '#lib/syncHash.js';
import { encryptSyncPayload, decryptSyncPayload } from '#lib/syncPairing.js';
import {
	isReminderHistoryEntry,
	RECEIPTS_PER_NOTE,
	type ReminderHistoryEntry
} from '#lib/reminderHistory.js';

export const REMINDER_CHANNEL_KEY = 'scrapscache-reminder-channel';
/** Notes per upload and per downloaded page. */
export const REMINDER_BATCH_SIZE = 12;
/**
 * A local change waiting to be uploaded; the service worker queues these too.
 * Uploads send the note's whole receipt row, so an event only marks its note.
 */
export type ReminderEvent =
	{ kind: 'handled'; value: ReminderHistoryEntry } | { kind: 'deleted'; noteId: string };
/** The sealed content of one relay row. */
export type NoteReceipts =
	| { kind: 'handled'; noteId: string; entries: ReminderHistoryEntry[] }
	| { kind: 'deleted'; noteId: string };
export type ReminderPacket = { note: string; deleted: boolean; ciphertext: string };
export type ReminderPage = {
	reset?: boolean;
	cursor: number;
	hasMore: boolean;
	notes: (ReminderPacket & { seq: number })[];
};
export type ReminderChannelState = {
	accountId: string;
	cursor: number;
	pending: ReminderEvent[];
	/** Notes deleted in this workspace; their receipts are never kept or sent again. */
	deletedNotes: Record<string, number>;
};

function isNoteId(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function isReminderEvent(value: unknown): value is ReminderEvent {
	const event = value as ReminderEvent | null;
	if (!event || typeof event !== 'object') return false;
	if (event.kind === 'handled') return isReminderHistoryEntry(event.value);
	return event.kind === 'deleted' && isNoteId(event.noteId);
}

/** Stored channel state, or a fresh one when nothing valid is stored. */
export function channelState(value: unknown): ReminderChannelState {
	const stored = value as Partial<ReminderChannelState> | null;
	const deletedNotes: Record<string, number> = {};
	if (stored?.deletedNotes && typeof stored.deletedNotes === 'object') {
		for (const [noteId, at] of Object.entries(stored.deletedNotes)) {
			if (isNoteId(noteId) && typeof at === 'number') deletedNotes[noteId] = at;
		}
	}
	return {
		accountId: typeof stored?.accountId === 'string' ? stored.accountId : '',
		cursor:
			Number.isSafeInteger(stored?.cursor) && Number(stored?.cursor) >= 0
				? Number(stored?.cursor)
				: 0,
		pending: Array.isArray(stored?.pending) ? stored.pending.filter(isReminderEvent) : [],
		deletedNotes
	};
}

export function eventNote(event: ReminderEvent): string {
	return event.kind === 'deleted' ? event.noteId : event.value.noteId;
}

async function noteToken(key: string, noteId: string): Promise<string> {
	return sha256(`${key}\0reminder-note:v1:${noteId}`);
}

function isNoteReceipts(value: unknown): value is NoteReceipts {
	const receipts = value as NoteReceipts | null;
	if (!receipts || typeof receipts !== 'object' || !isNoteId(receipts.noteId)) return false;
	if (receipts.kind === 'deleted') return true;
	return (
		receipts.kind === 'handled' &&
		Array.isArray(receipts.entries) &&
		receipts.entries.length > 0 &&
		receipts.entries.length <= RECEIPTS_PER_NOTE &&
		receipts.entries.every(
			(entry) => isReminderHistoryEntry(entry) && entry.noteId === receipts.noteId
		)
	);
}

/** Seal a note's row; the relay sees only a keyed note tag and whether it is deleted. */
export async function sealNoteReceipts(
	key: string,
	receipts: NoteReceipts
): Promise<ReminderPacket> {
	const note = await noteToken(key, receipts.noteId);
	return {
		note,
		deleted: receipts.kind === 'deleted',
		ciphertext: encryptSyncPayload(key, receipts, note)
	};
}

export async function openNoteReceipts(key: string, packet: ReminderPacket): Promise<NoteReceipts> {
	const receipts = decryptSyncPayload(key, packet.ciphertext, packet.note);
	if (!isNoteReceipts(receipts)) throw new Error('Invalid reminder receipt');
	if (
		(await noteToken(key, receipts.noteId)) !== packet.note ||
		(receipts.kind === 'deleted') !== packet.deleted
	)
		throw new Error('Reminder receipt does not match its note');
	return receipts;
}
