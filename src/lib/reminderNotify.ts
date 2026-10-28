// Local reminder display. The relay receives only opaque wake ids and timestamps.
import {
	reminderDueAt,
	reminderNextAt,
	reminderWakeId,
	type ReminderRepeat
} from '#lib/model/index.js';
import { formatReminder } from './utils';
import { plainLine } from './noteLine.js';

export type ReminderNote = {
	id: string;
	title: string;
	body: string;
	reminder: number | null;
	repeat?: ReminderRepeat | null;
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

export function reminderPreview(note: Pick<ReminderNote, 'title' | 'body'>): string {
	const title = note.title.trim();
	if (title) return title;
	for (const raw of (note.body ?? '').split('\n')) {
		const line = plainLine(raw);
		if (line) return line.slice(0, 80);
	}
	return 'Untitled note';
}

/** A note whose reminder is due, at the time it was due. */
export type DueReminder = { note: ReminderNote; at: number; wakeId: string };

/**
 * Each note's latest due time. A repeat missed several times is due once, for
 * the latest; the ones before it are not shown.
 */
export function dueReminders(notes: ReminderNote[], now: number): DueReminder[] {
	return notes.flatMap((note) => {
		if (note.archived || note.trashed) return [];
		const at = reminderDueAt(note, now);
		return at == null ? [] : [{ note, at, wakeId: reminderWakeId(note.id, at) }];
	});
}

export function nextReminderAt(notes: ReminderNote[], now: number): number | null {
	let next: number | null = null;
	for (const note of notes) {
		if (note.archived || note.trashed) continue;
		const at = reminderNextAt(note, now);
		if (at != null && (next == null || at < next)) next = at;
	}
	return next;
}

export function unfiredDueReminders(
	notes: ReminderNote[],
	fired: Iterable<string>,
	now: number
): DueReminder[] {
	const seen = fired instanceof Set ? fired : new Set(fired);
	return dueReminders(notes, now).filter((due) => !seen.has(due.wakeId));
}

/** How the iPhone app asks the system, which has no Notification API in its web view. */
export type NotificationBackend = {
	permission(): NotificationPermission;
	request(): Promise<NotificationPermission>;
};

let backend: NotificationBackend | null = null;

/** Fired on `window` when the backend changes, so a settings row rendered earlier asks again. */
export const NOTIFICATION_BACKEND_EVENT = 'scrapscache:notification-backend';

export function useNotificationBackend(next: NotificationBackend | null): void {
	backend = next;
	if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTIFICATION_BACKEND_EVENT));
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
	if (backend) return backend.permission();
	if (typeof Notification === 'undefined') return 'unsupported';
	return Notification.permission;
}

export async function requestReminderPermission(): Promise<NotificationPermission | 'unsupported'> {
	if (backend) return backend.request();
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

/**
 * What to do about notifications the user blocked. An installed app has no
 * browser UI or site settings; its block lives in the device's settings for it.
 */
export function notificationsBlockedHint(installedApp: boolean): string {
	return installedApp
		? "Blocked for this app. Allow notifications for Scraps Cache in the app's settings or your device's notification settings."
		: 'Blocked in the browser. Allow notifications for this site in its settings.';
}
