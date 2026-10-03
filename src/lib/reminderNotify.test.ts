import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	dueReminderNotes,
	nextReminderAt,
	reminderPreview,
	requestReminderPermission,
	showReminderNotification,
	unfiredDueReminders
} from './reminderNotify';
import { reminderWakeId } from '#lib/model/index.js';

function note(
	partial: Partial<{
		id: string;
		title: string;
		body: string;
		reminder: number | null;
		archived: boolean;
		trashed: boolean;
	}> = {}
) {
	return {
		id: '550e8400-e29b-41d4-a716-446655440000',
		title: 'Groceries',
		body: '',
		reminder: 100,
		archived: false,
		trashed: false,
		...partial
	};
}

describe('reminderPreview', () => {
	it('uses title, body fallback, and an untitled fallback', () => {
		expect(reminderPreview({ title: ' Buy milk ', body: 'ignored' })).toBe('Buy milk');
		expect(reminderPreview({ title: '', body: '\n[ ] Pick up oat milk\nmore' })).toBe(
			'Pick up oat milk'
		);
		expect(reminderPreview({ title: '', body: '   \n[ ]   ' })).toBe('Untitled note');
	});

	it('strips markdown bullet markers from body previews', () => {
		expect(reminderPreview({ title: '', body: '- Oat milk' })).toBe('Oat milk');
		expect(reminderPreview({ title: '', body: '  * Oat milk' })).toBe('Oat milk');
		expect(reminderPreview({ title: '', body: '+ [ ] Oat milk' })).toBe('Oat milk');
		expect(reminderPreview({ title: '', body: 'plain - text' })).toBe('plain - text');
	});
});

describe('reminder scheduling', () => {
	const now = 1_000;

	it('detects due reminders and skips a fired wake id', () => {
		const due = note({ reminder: now });
		expect(dueReminderNotes([due], now)).toEqual([due]);
		expect(unfiredDueReminders([due], [reminderWakeId(due.id, now)], now)).toEqual([]);
		expect(unfiredDueReminders([due], [], now)).toEqual([due]);
	});

	it('finds the soonest future reminder', () => {
		expect(
			nextReminderAt(
				[note({ id: 'a', reminder: now + 50 }), note({ id: 'b', reminder: now + 10 })],
				now
			)
		).toBe(now + 10);
		expect(nextReminderAt([note({ reminder: now })], now)).toBeNull();
	});
});

describe('system notifications', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('requests permission only while it is still default', async () => {
		const requestPermission = vi.fn().mockResolvedValue('granted');
		vi.stubGlobal('Notification', { permission: 'default', requestPermission });
		await expect(requestReminderPermission()).resolves.toBe('granted');
		expect(requestPermission).toHaveBeenCalledOnce();
	});

	it('uses the wake id as the notification dedupe tag', async () => {
		const show = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('Notification', { permission: 'granted' });
		vi.stubGlobal('navigator', {
			serviceWorker: { ready: Promise.resolve({ showNotification: show }) }
		});
		const wakeId = reminderWakeId('n1', 1);
		await expect(
			showReminderNotification({
				workspaceId: 'home',
				wakeId,
				noteId: 'n1',
				reminder: 1,
				title: 'Groceries'
			})
		).resolves.toBe(true);
		expect(show).toHaveBeenCalledWith(
			'Groceries',
			expect.objectContaining({
				tag: `scrapscache-reminder:${wakeId}`,
				data: { type: 'reminder', noteId: 'n1', wakeId, workspaceId: 'home', reminder: 1 }
			})
		);
	});

	it('does not show a system notification without permission', async () => {
		vi.stubGlobal('Notification', { permission: 'denied' });
		await expect(
			showReminderNotification({
				workspaceId: 'home',
				wakeId: reminderWakeId('n1', 1),
				noteId: 'n1',
				reminder: 1,
				title: 'Groceries'
			})
		).resolves.toBe(false);
	});
});

describe('closing reminders across workspace subscriptions', () => {
	it('closes matching notifications in the root and workspace registrations', async () => {
		const { closeReminderNotifications } = await import('./reminderNotify');
		const root = { data: { type: 'reminder', wakeId: 'handled' }, close: vi.fn() };
		const workspace = { data: { type: 'reminder', wakeId: 'handled' }, close: vi.fn() };
		const other = { data: { type: 'reminder', wakeId: 'unhandled' }, close: vi.fn() };
		vi.stubGlobal('navigator', {
			serviceWorker: {
				getRegistrations: async () => [
					{ getNotifications: async () => [root] },
					{ getNotifications: async () => [workspace, other] }
				]
			}
		});
		try {
			await closeReminderNotifications(new Set(['handled']));
			expect(root.close).toHaveBeenCalledOnce();
			expect(workspace.close).toHaveBeenCalledOnce();
			expect(other.close).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
