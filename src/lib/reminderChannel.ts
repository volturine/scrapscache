// Reminder receipts have their own encrypted transport, cursor and durable queue.
import { sha256 } from '$lib/syncHash';
import { encryptSyncPayload, decryptSyncEnvelope } from '$lib/syncPairing';
import { isReminderHistoryEntry, type ReminderHistoryEntry } from '$lib/reminderHistory';
import { stableStringify } from '$lib/model/stableStringify';

export const REMINDER_CHANNEL_KEY = 'scrapscache-reminder-channel';
export const REMINDER_BATCH_SIZE = 12;
export type ReminderEvent =
	{ kind: 'handled'; value: ReminderHistoryEntry } | { kind: 'deleted'; noteId: string };
export type ReminderPacket = { id: string; note: string; deleted: boolean; ciphertext: string };
export type ReminderPage = {
	reset?: boolean;
	cursor: number;
	hasMore: boolean;
	events: (ReminderPacket & { seq: number })[];
};
export type ReminderChannelState = {
	accountId: string;
	cursor: number;
	pending: ReminderEvent[];
	deletedNotes: Record<string, number>;
};
export function channelState(value: unknown): ReminderChannelState {
	return (
		(value as ReminderChannelState | undefined) ?? {
			accountId: '',
			cursor: 0,
			pending: [],
			deletedNotes: {}
		}
	);
}
export function eventNote(event: ReminderEvent): string {
	return event.kind === 'deleted' ? event.noteId : event.value.noteId;
}
export function mergeEvents(...lists: ReminderEvent[][]): ReminderEvent[] {
	return [...new Map(lists.flat().map((event) => [stableStringify(event), event])).values()];
}
async function eventTokens(key: string, event: ReminderEvent) {
	const id = await sha256(`${key}\0reminder-event:v1:${stableStringify(event)}`);
	const note = await sha256(`${key}\0reminder-note:v1:${eventNote(event)}`);
	return { id, note, deleted: event.kind === 'deleted' };
}
export async function sealReminderEvent(
	key: string,
	event: ReminderEvent
): Promise<ReminderPacket> {
	const tokens = await eventTokens(key, event);
	return { ...tokens, ciphertext: encryptSyncPayload(key, event, tokens.id) };
}
export async function openReminderEvent(
	key: string,
	packet: ReminderPacket
): Promise<ReminderEvent> {
	const opened = decryptSyncEnvelope(key, packet.ciphertext, packet.id);
	const event = opened.payload as ReminderEvent;
	if (
		opened.legacy ||
		!event ||
		!(event.kind === 'handled'
			? isReminderHistoryEntry(event.value)
			: event.kind === 'deleted' && typeof event.noteId === 'string' && event.noteId.length > 0)
	)
		throw new Error('Invalid reminder receipt');
	const expected = await eventTokens(key, event);
	if (
		expected.id !== packet.id ||
		expected.note !== packet.note ||
		expected.deleted !== packet.deleted
	)
		throw new Error('Reminder receipt does not match its slot');
	return event;
}
