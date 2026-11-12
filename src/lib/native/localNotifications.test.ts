import { describe, expect, it, vi } from 'vitest';
import { LocalNotifications } from '@capacitor/local-notifications';
import { wakeNotificationId } from '#lib/model/index.js';
import type { UpcomingReminder } from '#lib/stores/reminders.svelte.js';
import {
	notificationsFor,
	PENDING_LIMIT,
	readExtra,
	removeDeliveredReminders,
	scheduleSignature
} from './localNotifications.js';

vi.mock('@capacitor/local-notifications', () => ({
	LocalNotifications: { removeDeliveredNotificationsById: vi.fn(async () => undefined) }
}));

const at = Date.UTC(2030, 0, 7, 9, 0);
const reminder = (n: number): UpcomingReminder => ({
	workspaceId: 'w1',
	noteId: `note-${n}`,
	wakeId: `wake-${n}`,
	at: at + n * 60_000,
	title: `Note ${n}`
});

describe('notificationsFor', () => {
	it('names the note, says when, and keeps what a tap needs', () => {
		const [planned] = notificationsFor([reminder(1)]);
		expect(planned.id).toBe(wakeNotificationId('wake-1'));
		expect(planned.title).toBe('Note 1');
		expect(planned.schedule?.at?.getTime()).toBe(at + 60_000);
		expect(planned.extra).toEqual({
			workspaceId: 'w1',
			noteId: 'note-1',
			wakeId: 'wake-1',
			reminder: at + 60_000
		});
	});

	it('hands the system only as many as it keeps', () => {
		const many = Array.from({ length: PENDING_LIMIT + 10 }, (_, n) => reminder(n));
		expect(notificationsFor(many)).toHaveLength(PENDING_LIMIT);
	});
});

describe('scheduleSignature', () => {
	it('changes when a reminder moves, and not otherwise', () => {
		const same = scheduleSignature(notificationsFor([reminder(1), reminder(2)]));
		expect(scheduleSignature(notificationsFor([reminder(1), reminder(2)]))).toBe(same);
		const moved = { ...reminder(2), at: at + 5 * 60_000 };
		expect(scheduleSignature(notificationsFor([reminder(1), moved]))).not.toBe(same);
		// A renamed note must reach the system too, or it fires with the old title.
		const renamed = { ...reminder(2), title: 'Note 2, renamed' };
		expect(scheduleSignature(notificationsFor([reminder(1), renamed]))).not.toBe(same);
	});
});

describe('readExtra', () => {
	it('takes back what was handed over, and nothing else', () => {
		const extra = { workspaceId: 'w1', noteId: 'n1', wakeId: 'k1', reminder: at };
		expect(readExtra(extra)).toEqual(extra);
		expect(readExtra({ ...extra, reminder: 'soon' })).toBeNull();
		expect(readExtra(null)).toBeNull();
		expect(readExtra('x')).toBeNull();
	});
});

describe('removeDeliveredReminders', () => {
	it('removes the notifications of the answered reminders, by the ids they were scheduled under', async () => {
		const remove = vi.mocked(LocalNotifications.removeDeliveredNotificationsById);
		remove.mockClear();
		await removeDeliveredReminders(new Set(['wake-1', 'wake-2']));
		expect(remove).toHaveBeenCalledExactlyOnceWith({
			ids: [wakeNotificationId('wake-1'), wakeNotificationId('wake-2')]
		});
		expect(notificationsFor([reminder(1)])[0].id).toBe(wakeNotificationId('wake-1'));
	});

	it('asks the system nothing when no reminder was answered', async () => {
		const remove = vi.mocked(LocalNotifications.removeDeliveredNotificationsById);
		remove.mockClear();
		await removeDeliveredReminders(new Set());
		expect(remove).not.toHaveBeenCalled();
	});
});
