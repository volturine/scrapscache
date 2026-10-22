// Reminder wakes: the only reminder data the relay sees. Every writer that can
// change a reminder (the app and the MCP server) publishes the same snapshot, so
// devices that do not hold a note yet are still woken when it comes due.
import { sha256 } from '@noble/hashes/sha2.js';
import { reminderDueAt, reminderTimesBetween, type ReminderRepeat } from './reminderRepeat.js';

export type ReminderWake = {
	id: string;
	fireAt: number;
};

/** The fields of a note that decide its wake. */
export type WakeSource = {
	id: string;
	reminder: number | null;
	repeat?: ReminderRepeat | null;
	archived: boolean;
	trashed: boolean;
};

const WAKE_DOMAIN = 'scraps-cache-reminder-wake:v1\0';
export const RELAY_WAKE_RETAIN_MS = 24 * 60 * 60 * 1000;
export const MAX_RELAY_WAKES = 1_000;
/**
 * How far ahead a repeating reminder's times go to the relay. A device that
 * syncs sends the next stretch; past it, the relay wakes no one until a device
 * opens the app again.
 */
export const RELAY_REPEAT_AHEAD_MS = 60 * 24 * 60 * 60 * 1000;
/** A repeat that comes less often than the stretch still sends its next times. */
const RELAY_REPEAT_MIN = 2;

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** Stable across synced devices without exposing the random note id to the relay. */
export function reminderWakeId(noteId: string, reminder: number): string {
	return bytesToBase64Url(sha256(new TextEncoder().encode(`${WAKE_DOMAIN}${noteId}\0${reminder}`)));
}

/** A single reminder's time; for a repeating one, the latest gone and the next stretch. */
function wakeTimes(note: WakeSource, now: number): number[] {
	if (!note.repeat) return note.reminder == null ? [] : [note.reminder];
	const due = reminderDueAt(note, now);
	const ahead = reminderTimesBetween(note, now + 1, now + RELAY_REPEAT_AHEAD_MS);
	const next =
		ahead.length >= RELAY_REPEAT_MIN
			? ahead
			: reminderTimesBetween(note, now + 1, Number.MAX_SAFE_INTEGER, RELAY_REPEAT_MIN);
	return due == null ? next : [due, ...next];
}

/** Upcoming wakes plus recently due wakes, sorted so the relay cap retains the nearest work. */
export function relayReminderWakes(
	notes: WakeSource[],
	now: number,
	limit = MAX_RELAY_WAKES
): ReminderWake[] {
	const earliest = now - RELAY_WAKE_RETAIN_MS;
	const wakes = new Map<string, ReminderWake>();
	for (const note of notes) {
		if (note.archived || note.trashed || note.reminder == null) continue;
		for (const fireAt of wakeTimes(note, now)) {
			if (fireAt <= earliest) continue;
			const id = reminderWakeId(note.id, fireAt);
			wakes.set(id, { id, fireAt });
		}
	}
	return [...wakes.values()]
		.sort((left, right) => left.fireAt - right.fireAt || left.id.localeCompare(right.id))
		.slice(0, limit);
}
