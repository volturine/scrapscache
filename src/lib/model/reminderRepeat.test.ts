import { describe, expect, it } from 'vitest';
import {
	describeRepeat,
	firstRepeatTime,
	isReminderTime,
	moveRepeatTime,
	normalizeRepeat,
	reminderDueAt,
	reminderNextAt,
	reminderShownAt,
	reminderTimesBetween,
	repeatChoiceId,
	repeatChoices,
	repeatShortLabel,
	repeatTimes,
	sameRepeat,
	sameRepeatPattern,
	skipRepeatTime,
	type ReminderRepeat
} from './reminderRepeat.js';

const ZONE = 'Europe/Bratislava';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** An instant given as Bratislava wall-clock time. */
function bratislava(text: string): number {
	const at = Date.parse(`${text}Z`);
	// Bratislava is UTC+1 in winter and UTC+2 in summer.
	for (const offset of [1, 2]) {
		const candidate = at - offset * HOUR;
		const shown = new Intl.DateTimeFormat('sv-SE', {
			timeZone: ZONE,
			dateStyle: 'short',
			timeStyle: 'short'
		}).format(candidate);
		if (shown.replace(' ', 'T') === text.slice(0, 16)) return candidate;
	}
	throw new Error(`no such time ${text}`);
}

function shown(at: number, zone = ZONE): string {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			hourCycle: 'h23',
			weekday: 'short',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		})
			.formatToParts(at)
			.map((part) => [part.type, part.value])
	);
	return `${parts.weekday} ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function take(first: number, repeat: ReminderRepeat, count: number, from?: number): string[] {
	const times: string[] = [];
	for (const at of repeatTimes(first, repeat, from)) {
		times.push(shown(at, repeat.zone));
		if (times.length === count) break;
	}
	return times;
}

const repeat = (rest: Omit<ReminderRepeat, 'zone'>, zone = ZONE): ReminderRepeat => ({
	...rest,
	zone
});

describe('repeatTimes', () => {
	it('keeps the wall-clock time across the clocks going back and forward', () => {
		// Clocks go back on Sunday 25 October 2026 and forward on 28 March 2027.
		const daily = repeat({ unit: 'day', every: 1 });
		expect(take(bratislava('2026-10-24T09:00'), daily, 3)).toEqual([
			'Sat 2026-10-24 09:00',
			'Sun 2026-10-25 09:00',
			'Mon 2026-10-26 09:00'
		]);
		expect(take(bratislava('2027-03-27T09:00'), daily, 3)).toEqual([
			'Sat 2027-03-27 09:00',
			'Sun 2027-03-28 09:00',
			'Mon 2027-03-29 09:00'
		]);
	});

	it('comes as far past a skipped hour as it was meant to be, and once in a doubled one', () => {
		const daily = repeat({ unit: 'day', every: 1 });
		// 02:30 does not happen on 28 March 2027: the clock goes from 02:00 to 03:00.
		const times = take(bratislava('2027-03-27T02:30'), daily, 3);
		expect(times).toEqual(['Sat 2027-03-27 02:30', 'Sun 2027-03-28 03:30', 'Mon 2027-03-29 02:30']);
		// 02:30 happens twice on 25 October 2026; the first one counts.
		const times2 = repeatTimes(bratislava('2026-10-24T02:30'), daily);
		times2.next();
		const doubled = times2.next().value as number;
		expect(new Date(doubled).toISOString()).toBe('2026-10-25T00:30:00.000Z');
	});

	it('repeats every few days', () => {
		expect(take(bratislava('2026-10-22T08:00'), repeat({ unit: 'day', every: 3 }), 3)).toEqual([
			'Thu 2026-10-22 08:00',
			'Sun 2026-10-25 08:00',
			'Wed 2026-10-28 08:00'
		]);
	});

	it('repeats weekly on the first day, or on the days picked, from the first time on', () => {
		const first = bratislava('2026-10-22T08:00'); // a Thursday
		expect(take(first, repeat({ unit: 'week', every: 1 }), 2)).toEqual([
			'Thu 2026-10-22 08:00',
			'Thu 2026-10-29 08:00'
		]);
		expect(take(first, repeat({ unit: 'week', every: 1, weekdays: [1, 2, 3, 4, 5] }), 4)).toEqual([
			'Thu 2026-10-22 08:00',
			'Fri 2026-10-23 08:00',
			'Mon 2026-10-26 08:00',
			'Tue 2026-10-27 08:00'
		]);
		// Every other week on Monday, picked on a Thursday: from the coming Monday.
		expect(take(first, repeat({ unit: 'week', every: 2, weekdays: [1] }), 2)).toEqual([
			'Mon 2026-10-26 08:00',
			'Mon 2026-11-09 08:00'
		]);
		// Every other week, counted from the week it first comes in, Monday to Sunday.
		expect(take(first, repeat({ unit: 'week', every: 2, weekdays: [1, 0] }), 4)).toEqual([
			'Sun 2026-10-25 08:00',
			'Mon 2026-11-02 08:00',
			'Sun 2026-11-08 08:00',
			'Mon 2026-11-16 08:00'
		]);
	});

	it('puts the 31st on the last day of a shorter month without drifting', () => {
		expect(take(bratislava('2027-01-31T10:00'), repeat({ unit: 'month', every: 1 }), 4)).toEqual([
			'Sun 2027-01-31 10:00',
			'Sun 2027-02-28 10:00',
			'Wed 2027-03-31 10:00',
			'Fri 2027-04-30 10:00'
		]);
		expect(take(bratislava('2028-02-29T10:00'), repeat({ unit: 'year', every: 1 }), 3)).toEqual([
			'Tue 2028-02-29 10:00',
			'Wed 2029-02-28 10:00',
			'Thu 2030-02-28 10:00'
		]);
		expect(take(bratislava('2026-10-22T10:00'), repeat({ unit: 'month', every: 3 }), 3)).toEqual([
			'Thu 2026-10-22 10:00',
			'Fri 2027-01-22 10:00',
			'Thu 2027-04-22 10:00'
		]);
	});

	it('jumps straight to a later start', () => {
		const first = bratislava('2020-01-01T09:00');
		const from = bratislava('2026-10-22T12:00');
		expect(take(first, repeat({ unit: 'day', every: 1 }), 1, from)).toEqual([
			'Fri 2026-10-23 09:00'
		]);
		expect(take(first, repeat({ unit: 'week', every: 2 }), 1, from)).toEqual([
			'Wed 2026-10-28 09:00'
		]);
	});

	it('keeps the wall clock of the zone it was set in, on a device anywhere', () => {
		const first = Date.UTC(2026, 9, 22, 13, 0); // 09:00 in New York
		const times = take(first, repeat({ unit: 'day', every: 1 }, 'America/New_York'), 3);
		expect(times.map((time) => time.slice(-5))).toEqual(['09:00', '09:00', '09:00']);
	});
});

describe('a note with a repeating reminder', () => {
	const first = bratislava('2026-10-22T09:00');
	const note = { reminder: first, repeat: repeat({ unit: 'day', every: 1 }) };

	it('is due at the latest time gone, and only that one', () => {
		expect(reminderDueAt(note, first - 1)).toBeNull();
		expect(reminderDueAt(note, first)).toBe(first);
		// Three days missed: one reminder, for the latest.
		expect(reminderDueAt(note, bratislava('2026-10-25T10:00'))).toBe(
			bratislava('2026-10-25T09:00')
		);
	});

	it('shows its next time once one has come, and never turns overdue', () => {
		const later = bratislava('2026-10-22T09:30');
		expect(reminderNextAt(note, later)).toBe(bratislava('2026-10-23T09:00'));
		expect(reminderShownAt(note, later)).toBe(bratislava('2026-10-23T09:00'));
		expect(reminderShownAt({ reminder: first }, later)).toBe(first);
		expect(reminderNextAt({ reminder: first }, later)).toBeNull();
	});

	it('knows its own times', () => {
		expect(isReminderTime(note, bratislava('2026-11-30T09:00'))).toBe(true);
		expect(isReminderTime(note, bratislava('2026-11-30T09:01'))).toBe(false);
		expect(isReminderTime(note, first - DAY)).toBe(false);
		expect(
			reminderTimesBetween(note, bratislava('2026-10-24T00:00'), bratislava('2026-10-26T23:59'))
		).toEqual([
			bratislava('2026-10-24T09:00'),
			bratislava('2026-10-25T09:00'),
			bratislava('2026-10-26T09:00')
		]);
	});

	it('starts at its next time when the picked time has already gone', () => {
		const now = bratislava('2026-10-22T11:00');
		expect(firstRepeatTime(first, note.repeat, now)).toBe(bratislava('2026-10-23T09:00'));
		// A weekday repeat picked on a Saturday starts on Monday.
		const saturday = bratislava('2026-10-24T09:00');
		const workweek = repeat({ unit: 'week', every: 1, weekdays: [1, 2, 3, 4, 5] });
		expect(firstRepeatTime(saturday, workweek, saturday - HOUR)).toBe(
			bratislava('2026-10-26T09:00')
		);
	});
});

describe('repeat words', () => {
	const thursday = bratislava('2026-10-22T09:00');

	it('names the ready-made repeats for the picked day', () => {
		expect(repeatChoices(thursday, ZONE).map((choice) => choice.label)).toEqual([
			'Does not repeat',
			'Every day',
			'Every weekday',
			'Every week on Thursday',
			'Every month on the 22nd',
			'Every year on October 22'
		]);
	});

	it('says how often in a sentence and on a chip', () => {
		const custom = repeat({ unit: 'week', every: 2, weekdays: [1, 3] });
		expect(describeRepeat(thursday, custom)).toBe('every 2 weeks on Monday and Wednesday');
		expect(repeatShortLabel(thursday, custom)).toBe('Every 2 weeks');
		expect(repeatShortLabel(thursday, repeat({ unit: 'week', every: 1, weekdays: [1, 3] }))).toBe(
			'Mon, Wed'
		);
		expect(repeatShortLabel(thursday, repeat({ unit: 'month', every: 1 }))).toBe('Monthly');
		expect(
			describeRepeat(bratislava('2026-10-01T09:00'), repeat({ unit: 'month', every: 1 }))
		).toBe('every month on the 1st');
	});

	it('tells a ready-made repeat from a custom one', () => {
		expect(repeatChoiceId(thursday, null)).toBe('none');
		expect(repeatChoiceId(thursday, repeat({ unit: 'week', every: 1, weekdays: [4] }))).toBe(
			'week'
		);
		expect(repeatChoiceId(thursday, repeat({ unit: 'week', every: 1, weekdays: [1] }))).toBe(
			'custom'
		);
		expect(repeatChoiceId(thursday, repeat({ unit: 'day', every: 2 }))).toBe('custom');
	});
});

describe('normalizeRepeat', () => {
	it('keeps a valid repeat and sorts its days', () => {
		expect(normalizeRepeat({ unit: 'week', every: 1, weekdays: [5, 1, 1], zone: ZONE })).toEqual({
			unit: 'week',
			every: 1,
			weekdays: [1, 5],
			zone: ZONE
		});
	});

	it('drops what is not one', () => {
		expect(normalizeRepeat(null)).toBeUndefined();
		expect(normalizeRepeat({ unit: 'hour', every: 1, zone: ZONE })).toBeUndefined();
		expect(normalizeRepeat({ unit: 'day', every: 0, zone: ZONE })).toBeUndefined();
		expect(normalizeRepeat({ unit: 'day', every: 1.5, zone: ZONE })).toBeUndefined();
		expect(normalizeRepeat({ unit: 'day', every: 1, zone: 'Mars/Olympus' })).toBeUndefined();
		// Days only mean something weekly.
		expect(normalizeRepeat({ unit: 'day', every: 1, weekdays: [1], zone: ZONE })).toEqual({
			unit: 'day',
			every: 1,
			zone: ZONE
		});
	});
});

describe('a time skipped or moved by hand', () => {
	const daily = repeat({ unit: 'day', every: 1 });
	const first = bratislava('2026-10-22T09:00');
	const after = bratislava('2026-10-22T10:00');

	it('skips the time, so the next one is what comes', () => {
		const skipped = skipRepeatTime(daily, bratislava('2026-10-23T09:00'));
		expect(take(first, skipped, 2, after)).toEqual([
			'Sat 2026-10-24 09:00',
			'Sun 2026-10-25 09:00'
		]);
		const note = { reminder: first, repeat: skipped };
		expect(isReminderTime(note, bratislava('2026-10-23T09:00'))).toBe(false);
		expect(reminderNextAt(note, bratislava('2026-10-23T08:00'))).toBe(
			bratislava('2026-10-24T09:00')
		);
		// Nothing is due for the skipped time once it has passed.
		expect(reminderDueAt(note, bratislava('2026-10-23T12:00'))).toBeNull();
	});

	it('keeps a monthly 31st on the 31st after a skip, where moving the first time would not', () => {
		const jan = bratislava('2027-01-31T10:00');
		const skipped = skipRepeatTime(
			repeat({ unit: 'month', every: 1 }),
			bratislava('2027-02-28T10:00')
		);
		expect(take(jan, skipped, 2, bratislava('2027-02-01T00:00'))).toEqual([
			'Wed 2027-03-31 10:00',
			'Fri 2027-04-30 10:00'
		]);
	});

	it('puts a moved time in order, once', () => {
		const moved = moveRepeatTime(
			daily,
			bratislava('2026-10-23T09:00'),
			bratislava('2026-10-23T14:00')
		);
		expect(take(first, moved, 3, after)).toEqual([
			'Fri 2026-10-23 14:00',
			'Sat 2026-10-24 09:00',
			'Sun 2026-10-25 09:00'
		]);
		const note = { reminder: first, repeat: moved };
		expect(isReminderTime(note, bratislava('2026-10-23T14:00'))).toBe(true);
		expect(reminderNextAt(note, bratislava('2026-10-23T09:30'))).toBe(
			bratislava('2026-10-23T14:00')
		);
		// Moved past the next regular time, it comes after that one.
		const later = moveRepeatTime(
			daily,
			bratislava('2026-10-23T09:00'),
			bratislava('2026-10-24T12:00')
		);
		expect(take(first, later, 3, after)).toEqual([
			'Sat 2026-10-24 09:00',
			'Sat 2026-10-24 12:00',
			'Sun 2026-10-25 09:00'
		]);
	});

	it('skips a moved time on its own and leaves the series alone', () => {
		const moved = moveRepeatTime(
			daily,
			bratislava('2026-10-23T09:00'),
			bratislava('2026-10-23T14:00')
		);
		const skipped = skipRepeatTime(moved, bratislava('2026-10-23T14:00'));
		expect(skipped.moved).toBeUndefined();
		expect(skipped.skipUntil).toBe(bratislava('2026-10-23T09:00'));
		expect(take(first, skipped, 1, after)).toEqual(['Sat 2026-10-24 09:00']);
	});

	it('survives normalising, and a skip is not a change of pattern', () => {
		const skipped = { ...daily, skipUntil: 5, moved: 9 };
		expect(normalizeRepeat(skipped)).toEqual(skipped);
		expect(normalizeRepeat({ ...daily, skipUntil: 'soon', moved: 1.5 })).toEqual(daily);
		expect(sameRepeat(daily, skipped)).toBe(false);
		expect(sameRepeatPattern(daily, skipped)).toBe(true);
	});
});
