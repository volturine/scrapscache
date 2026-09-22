import { downloadFile } from '@zag-js/file-utils';
// Small utility helpers shared across components and stores.

/** Generate a reasonably unique id (crypto when available, fallback to Math.random). */
export function uid(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

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

/** Use the reminder picker's next-hour default time on a specific local calendar day. */
export function reminderTimeForDay(key: string, nowMs = Date.now()): number {
	const [year, month, day] = key.split('-').map(Number);
	const reminder = new Date(nowMs);
	reminder.setHours(reminder.getHours() + 1, 0, 0, 0);
	if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
		reminder.setFullYear(year, month - 1, day);
	}
	return reminder.getTime();
}

/** True when a reminder timestamp is in the past. */
export function isReminderOverdue(ts: number | null, now = Date.now()): boolean {
	return ts != null && ts < now;
}

/** Days a trashed note has been sitting in the trash. */
export function daysSinceTrashed(trashedAt: number | null): number {
	if (trashedAt == null) return Infinity;
	return (Date.now() - trashedAt) / (1000 * 60 * 60 * 24);
}

export const TRASH_PURGE_DAYS = 7;

/** Display state for a note's created/updated (or deleted) timestamp. */
export type NoteActivity = {
	/** Short relative label, e.g. "Edited 2h ago". */
	label: string;
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

function formatActivityRelative(ts: number, nowMs: number): string {
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
		return { label: `Deleted ${formatActivityRelative(deletedAt, nowMs)}`, at: deletedAt, detail };
	}
	if (neverEdited) {
		return {
			label: `Created ${formatActivityRelative(note.createdAt, nowMs)}`,
			at: note.createdAt,
			detail
		};
	}
	return {
		label: `Edited ${formatActivityRelative(note.updatedAt, nowMs)}`,
		at: note.updatedAt,
		detail
	};
}

/** Give pointer-activated card surfaces an equivalent keyboard interaction. */
export function activateOnKeyboard(event: KeyboardEvent, activate: () => void): void {
	if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
	event.preventDefault();
	activate();
}

/** Deep-clone a note for editing without mutating the stored one. Plain objects only. */
export function cloneNote(note: import('$lib/types').Note): import('$lib/types').Note {
	return {
		id: note.id,
		title: note.title,
		body: note.body,
		color: note.color,
		pinned: note.pinned,
		archived: note.archived,
		trashed: note.trashed,
		trashedAt: note.trashedAt,
		...(note.secret ? { secret: true } : {}),
		createdAt: note.createdAt,
		updatedAt: note.updatedAt,
		reminder: note.reminder,
		labels: [...note.labels],
		...(note.fieldTimes ? { fieldTimes: { ...note.fieldTimes } } : {}),
		...(note.images
			? {
					images: note.images.map((image) => ({
						id: image.id,
						mime: image.mime,
						dataUrl: image.dataUrl,
						createdAt: image.createdAt,
						...(image.name != null ? { name: image.name } : {}),
						...(image.thumbUrl ? { thumbUrl: image.thumbUrl } : {}),
						...(image.width != null ? { width: image.width } : {}),
						...(image.height != null ? { height: image.height } : {}),
						...(image.byteSize != null ? { byteSize: image.byteSize } : {}),
						...(image.contentHash ? { contentHash: image.contentHash } : {}),
						...(image.encodingVersion != null ? { encodingVersion: image.encodingVersion } : {})
					}))
				}
			: {}),
		...(note.linkPreviews?.length
			? {
					linkPreviews: note.linkPreviews.map((preview) => ({
						url: preview.url,
						hostname: preview.hostname,
						title: preview.title,
						...(preview.description ? { description: preview.description } : {}),
						...(preview.image ? { image: preview.image } : {}),
						...(preview.icon ? { icon: preview.icon } : {})
					}))
				}
			: {})
	};
}

/** Note clone for JSON backup: full note metadata, attachment meta + thumbs, never full image bytes. */
export function cloneNoteForBackup(note: import('$lib/types').Note): import('$lib/types').Note {
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
