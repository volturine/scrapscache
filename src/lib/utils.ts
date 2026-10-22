import type { Note } from '#lib/types.js';
import { downloadFile } from '@zag-js/file-utils';
import {
	copyNote,
	reminderShownAt,
	repeatShortLabel,
	type ReminderSchedule
} from '#lib/model/index.js';
// Small utility helpers shared across components and stores.

/** Format epoch ms as a human-friendly relative-ish string. */
export function formatReminder(ts: number | null, nowMs = Date.now()): string {
	if (ts == null) return '';
	const d = new Date(ts);
	const now = new Date(nowMs);
	const sameDay = d.toDateString() === now.toDateString();
	const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	if (sameDay) return `Today, ${time}`;
	const tomorrow = new Date(now);
	tomorrow.setDate(now.getDate() + 1);
	if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
	return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

function countLabel(n: number, unit: string): string {
	return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function addMonthsClamped(date: Date, count: number): Date {
	const next = new Date(date);
	const day = next.getDate();
	next.setMonth(next.getMonth() + count);
	if (next.getDate() !== day) next.setDate(0);
	return next;
}

/** Remaining time until a reminder fires, e.g. "in 2 months 5 days". */
export function formatReminderCountdown(ts: number, nowMs = Date.now()): string {
	if (ts < nowMs) return 'Overdue';
	const totalSeconds = Math.floor((ts - nowMs) / 1000);
	if (totalSeconds < 1) return 'Due now';

	const start = new Date(nowMs);
	const end = new Date(nowMs + totalSeconds * 1000);
	let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
	let monthMark = addMonthsClamped(start, months);
	if (monthMark.getTime() > end.getTime()) {
		months -= 1;
		monthMark = addMonthsClamped(start, months);
	}
	const years = Math.floor(months / 12);
	months = months % 12;

	const leftover = end.getTime() - monthMark.getTime();
	const days = Math.floor(leftover / 86_400_000);
	const hours = Math.floor((leftover % 86_400_000) / 3_600_000);
	const minutes = Math.floor((leftover % 3_600_000) / 60_000);
	const seconds = Math.floor((leftover % 60_000) / 1000);

	if (years > 0) {
		return months > 0
			? `in ${countLabel(years, 'year')} ${countLabel(months, 'month')}`
			: `in ${countLabel(years, 'year')}`;
	}
	if (months > 0) {
		return days > 0
			? `in ${countLabel(months, 'month')} ${countLabel(days, 'day')}`
			: `in ${countLabel(months, 'month')}`;
	}
	if (days > 0) {
		return hours > 0
			? `in ${countLabel(days, 'day')} ${countLabel(hours, 'hour')}`
			: `in ${countLabel(days, 'day')}`;
	}
	if (hours > 0) {
		return minutes > 0
			? `in ${countLabel(hours, 'hour')} ${countLabel(minutes, 'minute')}`
			: `in ${countLabel(hours, 'hour')}`;
	}
	if (minutes > 0) return `in ${countLabel(minutes, 'minute')}`;
	return `in ${countLabel(seconds, 'second')}`;
}

/** Local-time YYYY-MM-DD key for an epoch-ms timestamp, used to group by calendar day. */
export function dayKey(ts: number): string {
	const d = new Date(ts);
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${d.getFullYear()}-${month}-${day}`;
}

/** The first and last instant of the local days `from` to `to` ("YYYY-MM-DD"). */
export function dayKeySpan(from: string, to = from): { start: number; end: number } {
	const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
	const [toYear, toMonth, toDay] = to.split('-').map(Number);
	return {
		start: new Date(fromYear, fromMonth - 1, fromDay).getTime(),
		end: new Date(toYear, toMonth - 1, toDay + 1).getTime() - 1
	};
}

/** Use the reminder picker's next-hour default time on a specific local calendar day. */
export function reminderTimeForDay(key: string, nowMs = Date.now()): number {
	const [year, month, day] = key.split('-').map(Number);
	const reminder = new Date(nowMs);
	reminder.setHours(reminder.getHours() + 1, 0, 0, 0);
	if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
		reminder.setFullYear(year, month - 1, day);
	}
	// Rolling to the next hour can cross midnight; the day is then forced back
	// onto today and the time lands in the past. A seeded reminder must never be
	// born overdue, so late-evening seeds become an hour from now instead.
	const seeded = reminder.getTime();
	return seeded < nowMs && key === dayKey(nowMs) ? nowMs + 3_600_000 : seeded;
}

/** True when a reminder timestamp is in the past. */
export function isReminderOverdue(ts: number | null, now = Date.now()): boolean {
	return ts != null && ts < now;
}

/**
 * What a note's reminder says: "Tomorrow, 9:00 AM", or for a repeating one its
 * next time and how often, "Tomorrow, 9:00 AM · Daily". Only a single reminder
 * turns overdue; a repeating one moves on to its next time.
 */
export function reminderWords(
	note: ReminderSchedule,
	now = Date.now()
): { text: string; aria: string; overdue: boolean } | null {
	const shown = reminderShownAt(note, now);
	if (shown == null) return null;
	const when = formatReminder(shown, now);
	if (note.repeat) {
		const often = repeatShortLabel(shown, note.repeat);
		return {
			text: `${when} · ${often}`,
			aria: `Repeating reminder, ${when}, ${often.toLowerCase()}`,
			overdue: false
		};
	}
	const overdue = isReminderOverdue(shown, now);
	return {
		text: when,
		aria: overdue ? `Overdue reminder, ${when}` : `Reminder, ${when}`,
		overdue
	};
}

export const TRASH_PURGE_DAYS = 7;
const DAY_MS = 86_400_000;

/**
 * When a trashed note is deleted for good: the purge and the countdown both read
 * this. A missing or unusable trash time (old or malformed data) is due now.
 */
export function trashPurgeAt(trashedAt: number | null): number {
	return Number.isFinite(trashedAt) ? (trashedAt as number) + TRASH_PURGE_DAYS * DAY_MS : 0;
}

/** When a trashed note will be deleted for good, by calendar day; `soon` on its last two days. */
export function trashCountdown(
	trashedAt: number | null,
	nowMs = Date.now()
): { label: string; soon: boolean } {
	const localMidnight = (ms: number) => {
		const d = new Date(ms);
		return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	};
	// Rounding absorbs the 23- and 25-hour calendar days around DST changes.
	const days = Math.round((localMidnight(trashPurgeAt(trashedAt)) - localMidnight(nowMs)) / DAY_MS);
	if (days <= 0) return { label: 'Deletes today', soon: true };
	if (days === 1) return { label: 'Deletes tomorrow', soon: true };
	return { label: `Deletes in ${days} days`, soon: false };
}

/** Display state for a note's created/updated (or deleted) timestamp. */
export type NoteActivity = {
	/** Short relative label, e.g. "Edited 2h ago". */
	label: string;
	/** Absolute label, e.g. "Edited Mar 3, 2026, 10:32 AM". */
	absoluteLabel: string;
	/** Epoch ms the label is relative to. */
	at: number;
	/** Absolute detail for tooltips, e.g. "Created Mar 3, 2026, 10:32 AM · …". */
	detail: string;
};

type NoteActivitySource = {
	createdAt: number;
	updatedAt: number;
	trashed?: boolean;
	trashedAt?: number | null;
};

export function formatActivityRelative(ts: number, nowMs: number): string {
	const delta = nowMs - ts;
	if (delta < 60_000) return 'just now';
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
	const then = new Date(ts);
	const now = new Date(nowMs);
	if (then.toDateString() === now.toDateString()) {
		return `${Math.floor(delta / 3_600_000)}h ago`;
	}
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	if (then.toDateString() === yesterday.toDateString()) return 'Yesterday';
	const options: Intl.DateTimeFormatOptions =
		then.getFullYear() === now.getFullYear()
			? { month: 'short', day: 'numeric' }
			: { month: 'short', day: 'numeric', year: 'numeric' };
	return then.toLocaleDateString([], options);
}

function formatActivityAbsolute(ts: number): string {
	const d = new Date(ts);
	const date = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
	const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	return `${date}, ${time}`;
}

/**
 * Smart created/updated label for a note: "Created …" until the first edit,
 * "Edited …" afterwards, "Deleted …" while in trash.
 */
export function noteActivity(note: NoteActivitySource, nowMs = Date.now()): NoteActivity {
	const neverEdited = note.updatedAt <= note.createdAt;
	const deletedAt = note.trashed ? (note.trashedAt ?? note.updatedAt) : null;
	const parts = [`Created ${formatActivityAbsolute(note.createdAt)}`];
	if (!neverEdited) parts.push(`Edited ${formatActivityAbsolute(note.updatedAt)}`);
	if (deletedAt != null) parts.push(`Deleted ${formatActivityAbsolute(deletedAt)}`);
	const detail = parts.join(' · ');
	if (deletedAt != null) {
		return {
			label: `Deleted ${formatActivityRelative(deletedAt, nowMs)}`,
			absoluteLabel: `Deleted ${formatActivityAbsolute(deletedAt)}`,
			at: deletedAt,
			detail
		};
	}
	if (neverEdited) {
		return {
			label: `Created ${formatActivityRelative(note.createdAt, nowMs)}`,
			absoluteLabel: `Created ${formatActivityAbsolute(note.createdAt)}`,
			at: note.createdAt,
			detail
		};
	}
	return {
		label: `Edited ${formatActivityRelative(note.updatedAt, nowMs)}`,
		absoluteLabel: `Edited ${formatActivityAbsolute(note.updatedAt)}`,
		at: note.updatedAt,
		detail
	};
}

/**
 * Put text on the clipboard. Falls back to a hidden textarea where the async
 * API is missing (insecure origins). True only when the write landed.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		const area = document.createElement('textarea');
		area.value = text;
		area.style.position = 'fixed';
		area.style.opacity = '0';
		document.body.appendChild(area);
		area.select();
		try {
			return document.execCommand('copy');
		} catch {
			return false;
		} finally {
			document.body.removeChild(area);
		}
	}
}

/** Deep-clone a note for editing without mutating the stored one. Plain objects only. */
export function cloneNote(note: Note): Note {
	return copyNote(note);
}

/** Note clone for JSON backup: full note metadata, attachment meta + thumbs, never full image bytes. */
export function cloneNoteForBackup(note: Note): Note {
	const cloned = cloneNote(note);
	return {
		...cloned,
		images: (cloned.images ?? []).map((image) => ({
			...image,
			dataUrl: ''
		}))
	};
}

/** Download a JSON backup file in the browser. */
export function downloadJSON(data: unknown, filename: string): void {
	downloadFile({
		file: JSON.stringify(data, null, 2),
		name: filename,
		type: 'application/json'
	});
}
