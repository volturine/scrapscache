// Local reminder display. The relay receives only opaque wake ids and timestamps.
import { reminderWakeId } from '#lib/model/index.js';
import { formatReminder } from './utils';

export type ReminderNote = {
	id: string;
	title: string;
	body: string;
	reminder: number | null;
	archived: boolean;
	trashed: boolean;
};

export type ReminderAlert = {
	/** The workspace the note is in, which need not be the open one. */
	workspaceId: string;
	wakeId: string;
	noteId: string;
	reminder: number;
	title: string;
};

const CHECKLIST_PREFIX = /^(?:\s*(?:[-*•]\s+)?)?\[[ xX]?\]\s*/;
const BULLET_PREFIX = /^\s*[-*+•]\s+/;

export function reminderPreview(note: Pick<ReminderNote, 'title' | 'body'>): string {
	const title = note.title.trim();
	if (title) return title;
	for (const raw of (note.body ?? '').split('\n')) {
		const line = raw.replace(BULLET_PREFIX, '').replace(CHECKLIST_PREFIX, '').trim();
		if (line) return line.slice(0, 80);
	}
	return 'Untitled note';
}

export function dueReminderNotes(notes: ReminderNote[], now: number): ReminderNote[] {
	return notes.filter(
		(note) => !note.archived && !note.trashed && note.reminder != null && note.reminder <= now
	);
}

export function nextReminderAt(notes: ReminderNote[], now: number): number | null {
	let next: number | null = null;
	for (const note of notes) {
		if (note.archived || note.trashed || note.reminder == null || note.reminder <= now) continue;
		if (next == null || note.reminder < next) next = note.reminder;
	}
	return next;
}

export function unfiredDueReminders(
	notes: ReminderNote[],
	fired: Iterable<string>,
	now: number
): ReminderNote[] {
	const seen = fired instanceof Set ? fired : new Set(fired);
	return dueReminderNotes(notes, now).filter(
		(note) => !seen.has(reminderWakeId(note.id, note.reminder as number))
	);
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
	if (typeof Notification === 'undefined') return 'unsupported';
	return Notification.permission;
}

export async function requestReminderPermission(): Promise<NotificationPermission | 'unsupported'> {
	if (typeof Notification === 'undefined') return 'unsupported';
	if (Notification.permission !== 'default') return Notification.permission;
	try {
		return await Notification.requestPermission();
	} catch {
		return 'denied';
	}
}

export async function showReminderNotification(
	alert: ReminderAlert,
	onClick?: () => void
): Promise<boolean> {
	if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
	const payload: NotificationOptions = {
		body: formatReminder(alert.reminder),
		tag: `scrapscache-reminder:${alert.wakeId}`,
		icon: '/icon-192.png',
		data: {
			type: 'reminder',
			noteId: alert.noteId,
			wakeId: alert.wakeId,
			workspaceId: alert.workspaceId,
			reminder: alert.reminder
		}
	};
	try {
		// `ready` never settles while no worker is active (development, a first
		// visit still installing), so ask for the registration as it is now.
		const registration = await navigator.serviceWorker?.getRegistration();
		if (registration?.active) {
			await registration.showNotification(alert.title, payload);
			return true;
		}
		const notification = new Notification(alert.title, payload);
		notification.onclick = () => {
			onClick?.();
			notification.close();
			window.focus();
		};
		return true;
	} catch {
		return false;
	}
}

/** Take down system notifications for reminders that were dismissed elsewhere. */
export async function closeReminderNotifications(wakeIds: ReadonlySet<string>): Promise<void> {
	if (!wakeIds.size || typeof navigator === 'undefined' || !navigator.serviceWorker) return;
	try {
		const registrations = await navigator.serviceWorker.getRegistrations();
		const shown = (
			await Promise.all(
				registrations.map((registration) => registration.getNotifications().catch(() => []))
			)
		).flat();
		for (const notification of shown) {
			const data = notification.data as { type?: unknown; wakeId?: unknown } | null;
			if (data?.type === 'reminder' && typeof data.wakeId === 'string' && wakeIds.has(data.wakeId))
				notification.close();
		}
	} catch {
		/* Notifications stay up; the user can still dismiss them. */
	}
}
