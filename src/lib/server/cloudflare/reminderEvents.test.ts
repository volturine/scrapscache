import { describe, expect, it, vi } from 'vitest';
import { ReminderScheduler } from '../../../../cf/reminders';
const bindings = vi.hoisted(() => ({ value: {} as unknown }));
vi.mock('./env', () => ({ cloudflareBindings: () => bindings.value }));
import { openReminderEvents, notifyReminderEvents } from './reminderEvents';

describe('Workers reminder event routing', () => {
	it('fans out through the per-account reminder scheduler, independently of note sync', async () => {
		const schedulers = new Map<string, ReminderScheduler>();
		bindings.value = {
			REMINDER_SCHEDULER: {
				idFromName: (id: string) => id,
				get: (id: string) => ({
					fetch: (url: string, init?: RequestInit) => {
						let scheduler = schedulers.get(id);
						if (!scheduler) {
							scheduler = new ReminderScheduler({} as never, {} as never);
							schedulers.set(id, scheduler);
						}
						return scheduler.fetch(new Request(url, init));
					}
				})
			}
		};
		const a = (await openReminderEvents('a')).body!.getReader();
		const b = (await openReminderEvents('b')).body!.getReader();
		await a.read();
		await b.read();
		try {
			const next = a.read();
			await notifyReminderEvents('a');
			expect(new TextDecoder().decode((await next).value)).toBe('data: {}\n\n');
			let otherNotified = false;
			const other = b.read().then((value) => {
				otherNotified = !value.done;
			});
			await b.cancel();
			await other;
			expect(otherNotified).toBe(false);
		} finally {
			await a.cancel();
			await b.cancel();
		}
	});
});
