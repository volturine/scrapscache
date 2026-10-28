// Reminders in the iPhone app: the system fires them, from a schedule the app
// keeps current. Nothing leaves the device; the titles are the notes' own.
import type { PluginListenerHandle } from '@capacitor/core';
import {
	LocalNotifications,
	type LocalNotificationSchema,
	type PermissionStatus
} from '@capacitor/local-notifications';
import type { UpcomingReminder } from '#lib/stores/reminders.svelte.js';
import { formatReminder } from '#lib/utils.js';

/** iOS keeps 64 pending notifications per app; later reminders wait for the next sync. */
export const PENDING_LIMIT = 60;

/** A stable positive 31-bit id for a wake, since the system wants numbers. */
export function notificationId(wakeId: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < wakeId.length; index += 1) {
		hash ^= wakeId.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0) & 0x7fffffff;
}

/** What tapping a notification hands back to the app. */
export type NotificationExtra = {
	workspaceId: string;
	noteId: string;
	wakeId: string;
	reminder: number;
};

export function notificationsFor(upcoming: UpcomingReminder[]): LocalNotificationSchema[] {
	return upcoming.slice(0, PENDING_LIMIT).map((item) => {
		const extra: NotificationExtra = {
			workspaceId: item.workspaceId,
			noteId: item.noteId,
			wakeId: item.wakeId,
			reminder: item.at
		};
		return {
			id: notificationId(item.wakeId),
			title: item.title,
			body: formatReminder(item.at),
			schedule: { at: new Date(item.at) },
			extra
		};
	});
}

/** Names a schedule, so one the system already holds is left alone. */
export function scheduleSignature(planned: LocalNotificationSchema[]): string {
	return planned.map((item) => `${item.id}@${item.schedule?.at?.getTime() ?? 0}`).join(',');
}

let scheduled = '';

/** Replace the system's pending reminders with what is upcoming now. */
export async function scheduleReminderNotifications(upcoming: UpcomingReminder[]): Promise<void> {
	const planned = notificationsFor(upcoming);
	const signature = scheduleSignature(planned);
	if (signature === scheduled) return;
	const pending = await LocalNotifications.getPending();
	if (pending.notifications.length > 0) {
		await LocalNotifications.cancel({
			notifications: pending.notifications.map((item) => ({ id: item.id }))
		});
	}
	if (planned.length > 0) await LocalNotifications.schedule({ notifications: planned });
	scheduled = signature;
}

function permissionOf(status: PermissionStatus): NotificationPermission {
	if (status.display === 'granted') return 'granted';
	if (status.display === 'denied') return 'denied';
	return 'default';
}

let permission: NotificationPermission = 'default';

/** The answer last heard from the system; `refreshPermission` asks it again. */
export function currentPermission(): NotificationPermission {
	return permission;
}

export async function refreshPermission(): Promise<NotificationPermission> {
	permission = permissionOf(await LocalNotifications.checkPermissions());
	return permission;
}

export async function requestPermission(): Promise<NotificationPermission> {
	permission = permissionOf(await LocalNotifications.requestPermissions());
	return permission;
}

export function readExtra(value: unknown): NotificationExtra | null {
	if (!value || typeof value !== 'object') return null;
	const extra = value as Partial<NotificationExtra>;
	if (typeof extra.workspaceId !== 'string' || typeof extra.wakeId !== 'string') return null;
	if (typeof extra.noteId !== 'string' || typeof extra.reminder !== 'number') return null;
	return {
		workspaceId: extra.workspaceId,
		noteId: extra.noteId,
		wakeId: extra.wakeId,
		reminder: extra.reminder
	};
}

/** A tap on a reminder notification, with what it was about. */
export function onNotificationTap(
	handler: (extra: NotificationExtra) => void
): Promise<PluginListenerHandle> {
	return LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
		const extra = readExtra(action.notification.extra);
		if (extra) handler(extra);
	});
}
