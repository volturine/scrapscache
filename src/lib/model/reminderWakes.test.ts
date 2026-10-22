import { describe, expect, it } from 'vitest';
import {
	relayReminderWakes,
	RELAY_REPEAT_AHEAD_MS,
	RELAY_WAKE_RETAIN_MS,
	reminderWakeId,
	type WakeSource
} from './index';

function note(partial: Partial<WakeSource> = {}): WakeSource {
	return { id: 'note-1', reminder: null, archived: false, trashed: false, ...partial };
}

describe('reminder wake identity and scheduling', () => {
	const now = 1_000;

	it('derives one stable opaque id per note and scheduled time', () => {
		const first = reminderWakeId('note-a', 10);
		expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(reminderWakeId('note-a', 10)).toBe(first);
		expect(reminderWakeId('note-a', 11)).not.toBe(first);
		expect(reminderWakeId('note-b', 10)).not.toBe(first);
	});

	it('keeps the wire format every writer and the service worker derive', () => {
		// SHA-256 of "scraps-cache-reminder-wake:v1\0note-a\01790000000000", Base64URL.
		expect(reminderWakeId('note-a', 1_790_000_000_000)).toBe(
			'KF2Uqldw0Rk-G-3Q53tTgfPtymnms48Rkks3tUian18'
		);
	});

	it('keeps distinct reminders at the same timestamp', () => {
		const wakes = relayReminderWakes(
			[note({ id: 'note-a', reminder: now + 10 }), note({ id: 'note-b', reminder: now + 10 })],
			now
		);
		expect(wakes).toHaveLength(2);
		expect(new Set(wakes.map((wake) => wake.id)).size).toBe(2);
		expect(wakes.map((wake) => wake.fireAt)).toEqual([now + 10, now + 10]);
	});

	it('uploads upcoming and recently due wakes but excludes stale and hidden notes', () => {
		const wakes = relayReminderWakes(
			[
				note({ id: 'due', reminder: now }),
				note({ id: 'soon', reminder: now + 10 }),
				note({ id: 'old', reminder: now - RELAY_WAKE_RETAIN_MS }),
				note({ id: 'arch', reminder: now, archived: true }),
				note({ id: 'bin', reminder: now, trashed: true })
			],
			now
		);
		expect(wakes.map((wake) => wake.fireAt)).toEqual([now, now + 10]);
	});
});

describe('repeating reminder wakes', () => {
	const DAY = 24 * 60 * 60 * 1000;
	const first = Date.UTC(2026, 9, 1, 7, 0);
	const now = Date.UTC(2026, 9, 22, 12, 0);

	it('sends the latest time gone and the next stretch, one wake per time', () => {
		const wakes = relayReminderWakes(
			[note({ reminder: first, repeat: { unit: 'day', every: 1, zone: 'UTC' } })],
			now
		);
		const times = wakes.map((wake) => wake.fireAt);
		expect(times[0]).toBe(Date.UTC(2026, 9, 22, 7, 0));
		expect(times[1]).toBe(Date.UTC(2026, 9, 23, 7, 0));
		expect(times.at(-1)).toBeLessThanOrEqual(now + RELAY_REPEAT_AHEAD_MS);
		expect(times).toHaveLength(61);
		expect(wakes[1].id).toBe(reminderWakeId('note-1', times[1]));
	});

	it('sends a yearly repeat its next times though they are further off', () => {
		const wakes = relayReminderWakes(
			[note({ reminder: first, repeat: { unit: 'year', every: 1, zone: 'UTC' } })],
			now
		);
		expect(wakes.map((wake) => new Date(wake.fireAt).getUTCFullYear())).toEqual([2027, 2028]);
	});

	it('sends nothing for a repeat on a hidden note', () => {
		const repeat = { unit: 'day', every: 1, zone: 'UTC' } as const;
		expect(
			relayReminderWakes([note({ reminder: now - 3 * DAY, repeat, archived: true })], now)
		).toEqual([]);
	});
});
