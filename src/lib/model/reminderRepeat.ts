// Repeating reminders. A note's `reminder` is the first time it comes; `repeat`
// says how it comes again. The times are worked out on each device and never
// stored, so a reminder that fired moves on to its next time without a write.
//
// The wall-clock time is kept in the time zone the repeat was set in, so every
// device, wherever it is, wakes at the same instants and shares one wake id per
// time: "every day at 9" set in Bratislava stays 9:00 Bratislava time.

export type RepeatUnit = 'day' | 'week' | 'month' | 'year';

export type ReminderRepeat = {
	unit: RepeatUnit;
	/** Every this many units, 1 or more. */
	every: number;
	/**
	 * Weekly only: the days it comes on, 0 = Sunday to 6 = Saturday, sorted.
	 * Absent: the day of the first time.
	 */
	weekdays?: number[];
	/** The IANA time zone its wall-clock time is kept in. */
	zone: string;
};

/** What a note's reminder is made of. */
export type ReminderSchedule = {
	reminder: number | null;
	repeat?: ReminderRepeat | null;
};

const DAY = 86_400_000;
export const MAX_REPEAT_EVERY = 999;
const UNITS: readonly RepeatUnit[] = ['day', 'week', 'month', 'year'];

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(zone: string): Intl.DateTimeFormat | null {
	let format = formatters.get(zone);
	if (format === undefined) {
		try {
			format = new Intl.DateTimeFormat('en-US', {
				timeZone: zone,
				hourCycle: 'h23',
				year: 'numeric',
				month: 'numeric',
				day: 'numeric',
				hour: 'numeric',
				minute: 'numeric',
				second: 'numeric'
			});
		} catch {
			format = null;
		}
		formatters.set(zone, format);
	}
	return format;
}

export function isTimeZone(zone: unknown): zone is string {
	return typeof zone === 'string' && zone.length > 0 && zone.length < 64 && !!formatter(zone);
}

/** This device's time zone. */
export function localTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** What the clock in `zone` reads at `ms`, written as if that reading were UTC. */
function wallClock(ms: number, zone: string): number {
	const parts: Record<string, number> = {};
	for (const part of formatter(zone)!.formatToParts(ms)) parts[part.type] = Number(part.value);
	const seconds = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour % 24,
		parts.minute,
		parts.second
	);
	return seconds + (((ms % 1000) + 1000) % 1000);
}

/**
 * When the clock in `zone` reads `wall`. A reading that happens twice (clocks
 * going back) takes the first; one that never happens (clocks going forward)
 * comes as far past the change as it was meant to be.
 */
function instantOf(wall: number, zone: string): number {
	const before = wallClock(wall - DAY, zone) - (wall - DAY);
	const after = wallClock(wall + DAY, zone) - (wall + DAY);
	const fits = [wall - before, wall - after].filter((at) => wallClock(at, zone) === wall);
	return fits.length ? Math.min(...fits) : wall - before;
}

function weekday(day: number): number {
	return (((day + 4) % 7) + 7) % 7;
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The weekdays a weekly repeat comes on, Monday first. */
function weekdaysOf(repeat: ReminderRepeat, firstDay: number): number[] {
	const days = repeat.weekdays?.length ? repeat.weekdays : [weekday(firstDay)];
	return [...days].sort((left, right) => ((left + 6) % 7) - ((right + 6) % 7));
}

/** The calendar days (days since 1970-01-01) a repeat comes on, from about `fromDay` on. */
function* repeatDays(repeat: ReminderRepeat, firstDay: number, fromDay: number) {
	const every = repeat.every;
	switch (repeat.unit) {
		case 'day': {
			for (let k = Math.max(0, Math.floor((fromDay - firstDay) / every)); ; k++) {
				yield firstDay + k * every;
			}
		}
		case 'week': {
			// Weeks start on Monday. "Every 2 weeks" counts from the week it first
			// comes in: picked on a Wednesday for Mondays, that is the coming Monday's.
			const offsets = weekdaysOf(repeat, firstDay).map((day) => (day + 6) % 7);
			const ownWeek = firstDay - ((weekday(firstDay) + 6) % 7);
			const firstWeek = offsets.some((offset) => ownWeek + offset >= firstDay)
				? ownWeek
				: ownWeek + 7;
			for (let k = Math.max(0, Math.floor((fromDay - firstWeek) / (7 * every))); ; k++) {
				for (const offset of offsets) {
					const day = firstWeek + k * 7 * every + offset;
					if (day >= firstDay) yield day;
				}
			}
		}
		case 'month':
		case 'year': {
			const first = new Date(firstDay * DAY);
			const from = new Date(fromDay * DAY);
			const step = repeat.unit === 'month' ? every : every * 12;
			const firstMonth = first.getUTCFullYear() * 12 + first.getUTCMonth();
			const fromMonth = from.getUTCFullYear() * 12 + from.getUTCMonth();
			// The 31st comes on the last day of a shorter month, and 29 February on the 28th.
			for (let k = Math.max(0, Math.floor((fromMonth - firstMonth) / step)); ; k++) {
				const month = firstMonth + k * step;
				const year = Math.floor(month / 12);
				const day = Math.min(first.getUTCDate(), daysInMonth(year, month % 12));
				yield Date.UTC(year, month % 12, day) / DAY;
			}
		}
	}
}

/** The times a repeat comes, from `from` on (and never before `first`), in order. */
export function* repeatTimes(
	first: number,
	repeat: ReminderRepeat,
	from = first
): Generator<number, void> {
	const zone = repeat.zone;
	if (!formatter(zone)) return;
	const firstWall = wallClock(first, zone);
	const firstDay = Math.floor(firstWall / DAY);
	const timeOfDay = firstWall - firstDay * DAY;
	const start = Math.max(first, from);
	// A day of slack: the wall clock and UTC days need not line up.
	const fromDay = Math.floor(wallClock(start, zone) / DAY) - 1;
	for (const day of repeatDays(repeat, firstDay, fromDay)) {
		const at = instantOf(day * DAY + timeOfDay, zone);
		if (at >= start) yield at;
	}
}

function firstOf(times: Iterable<number>): number | null {
	for (const at of times) return at;
	return null;
}

/** The longest a repeat can go between two times, with room for clock changes. */
function longestGap(repeat: ReminderRepeat): number {
	const days = { day: 1, week: 7, month: 31, year: 366 }[repeat.unit];
	return (days * repeat.every + 2) * DAY;
}

/** The latest time at or before `at`, or null before the first. */
function lastRepeatTime(first: number, repeat: ReminderRepeat, at: number): number | null {
	if (first > at) return null;
	let last: number | null = null;
	for (const time of repeatTimes(first, repeat, Math.max(first, at - longestGap(repeat)))) {
		if (time > at) break;
		last = time;
	}
	return last;
}

/** The time the reminder is due at by `now`: the latest one passed, or null if none has. */
export function reminderDueAt(note: ReminderSchedule, now: number): number | null {
	if (note.reminder == null) return null;
	if (!note.repeat) return note.reminder <= now ? note.reminder : null;
	return lastRepeatTime(note.reminder, note.repeat, now);
}

/** The next time after `now`, or null if it will not come again. */
export function reminderNextAt(note: ReminderSchedule, now: number): number | null {
	if (note.reminder == null) return null;
	if (!note.repeat) return note.reminder > now ? note.reminder : null;
	return firstOf(repeatTimes(note.reminder, note.repeat, now + 1));
}

/**
 * The time to show for a reminder: a repeating one shows its next time, so it
 * moves on once it fired; a single one keeps its time and turns overdue.
 */
export function reminderShownAt(note: ReminderSchedule, now: number): number | null {
	if (note.reminder == null) return null;
	if (!note.repeat) return note.reminder;
	return reminderNextAt(note, now) ?? note.reminder;
}

/** Whether `at` is one of the reminder's times. */
export function isReminderTime(note: ReminderSchedule, at: number): boolean {
	if (note.reminder == null) return false;
	if (!note.repeat) return note.reminder === at;
	return firstOf(repeatTimes(note.reminder, note.repeat, at)) === at;
}

/** The reminder's times in [from, to], at most `limit` of them. */
export function reminderTimesBetween(
	note: ReminderSchedule,
	from: number,
	to: number,
	limit = 400
): number[] {
	if (note.reminder == null) return [];
	if (!note.repeat) return note.reminder >= from && note.reminder <= to ? [note.reminder] : [];
	const times: number[] = [];
	for (const at of repeatTimes(note.reminder, note.repeat, from)) {
		if (at > to || times.length >= limit) break;
		times.push(at);
	}
	return times;
}

/**
 * A repeat first set at `picked`: a time already gone today moves to its next
 * time, so saving "every day at 9" at 11:00 does not fire at once for this morning.
 */
export function firstRepeatTime(picked: number, repeat: ReminderRepeat, now: number): number {
	if (picked > now) return firstOf(repeatTimes(picked, repeat)) ?? picked;
	return firstOf(repeatTimes(picked, repeat, now + 1)) ?? picked;
}

/** A stored or received repeat, or undefined when it is not a valid one. */
export function normalizeRepeat(value: unknown): ReminderRepeat | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const raw = value as Record<string, unknown>;
	const unit = raw.unit as RepeatUnit;
	const every = Number(raw.every);
	if (!UNITS.includes(unit) || !Number.isInteger(every) || every < 1 || every > MAX_REPEAT_EVERY)
		return undefined;
	if (!isTimeZone(raw.zone)) return undefined;
	const repeat: ReminderRepeat = { unit, every, zone: raw.zone };
	if (unit === 'week' && Array.isArray(raw.weekdays)) {
		const days = [...new Set(raw.weekdays.map(Number))]
			.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
			.sort((left, right) => left - right);
		if (days.length) repeat.weekdays = days;
	}
	return repeat;
}

export function sameRepeat(
	left: ReminderRepeat | null | undefined,
	right: ReminderRepeat | null | undefined
): boolean {
	if (!left || !right) return !left === !right;
	return (
		left.unit === right.unit &&
		left.every === right.every &&
		left.zone === right.zone &&
		(left.weekdays ?? []).join() === (right.weekdays ?? []).join()
	);
}

// Words for a repeat. The app speaks English, so day and month names do too.

const WEEKDAY_NAMES = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday'
];
const WORKWEEK = '1,2,3,4,5';

function ordinal(day: number): string {
	const tens = day % 100;
	if (tens >= 11 && tens <= 13) return `${day}th`;
	return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`;
}

function listOf(words: string[]): string {
	return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** The first time's calendar day in the repeat's zone. */
function firstDate(first: number, repeat: ReminderRepeat): Date {
	return new Date(Math.floor(wallClock(first, repeat.zone) / DAY) * DAY);
}

function repeatWeekdays(first: number, repeat: ReminderRepeat): number[] {
	return weekdaysOf(repeat, Math.floor(wallClock(first, repeat.zone) / DAY));
}

/** Every weekday, Monday to Friday, every week. */
export function isWorkweek(repeat: ReminderRepeat): boolean {
	return repeat.unit === 'week' && repeat.every === 1 && repeat.weekdays?.join() === WORKWEEK;
}

/** "every day", "every week on Thursday", "every 2 months on the 31st". */
export function describeRepeat(first: number, repeat: ReminderRepeat): string {
	if (isWorkweek(repeat)) return 'every weekday';
	const date = firstDate(first, repeat);
	const count = repeat.every === 1 ? repeat.unit : `${repeat.every} ${repeat.unit}s`;
	switch (repeat.unit) {
		case 'day':
			return `every ${count}`;
		case 'week':
			return `every ${count} on ${listOf(repeatWeekdays(first, repeat).map((day) => WEEKDAY_NAMES[day]))}`;
		case 'month':
			return `every ${count} on the ${ordinal(date.getUTCDate())}`;
		case 'year':
			return `every ${count} on ${date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}`;
	}
}

/** A word or two for a reminder chip: "Daily", "Mon, Wed", "Every 2 weeks". */
export function repeatShortLabel(first: number, repeat: ReminderRepeat): string {
	if (isWorkweek(repeat)) return 'Weekdays';
	const days = repeatWeekdays(first, repeat);
	if (repeat.every === 1) {
		if (repeat.unit === 'week' && days.length > 1) {
			return days.map((day) => WEEKDAY_NAMES[day].slice(0, 3)).join(', ');
		}
		return { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[repeat.unit];
	}
	return `Every ${repeat.every} ${repeat.unit}s`;
}

export type RepeatChoice = { id: string; label: string; repeat: ReminderRepeat | null };

/** The picker's ready-made repeats, named for the picked day. */
export function repeatChoices(first: number, zone: string): RepeatChoice[] {
	const make = (repeat: Omit<ReminderRepeat, 'zone'>): ReminderRepeat => ({ ...repeat, zone });
	const choices: RepeatChoice[] = [
		{ id: 'day', label: '', repeat: make({ unit: 'day', every: 1 }) },
		{
			id: 'workweek',
			label: '',
			repeat: make({ unit: 'week', every: 1, weekdays: [1, 2, 3, 4, 5] })
		},
		{ id: 'week', label: '', repeat: make({ unit: 'week', every: 1 }) },
		{ id: 'month', label: '', repeat: make({ unit: 'month', every: 1 }) },
		{ id: 'year', label: '', repeat: make({ unit: 'year', every: 1 }) }
	];
	for (const choice of choices) {
		const words = describeRepeat(first, choice.repeat!);
		choice.label = words[0].toUpperCase() + words.slice(1);
	}
	return [{ id: 'none', label: 'Does not repeat', repeat: null }, ...choices];
}

/** Which ready-made repeat this is, or 'custom'. */
export function repeatChoiceId(first: number, repeat: ReminderRepeat | null | undefined): string {
	if (!repeat) return 'none';
	if (isWorkweek(repeat)) return 'workweek';
	if (repeat.every !== 1) return 'custom';
	if (repeat.unit !== 'week') return repeat.unit;
	const days = repeat.weekdays ?? [];
	const own = weekday(Math.floor(wallClock(first, repeat.zone) / DAY));
	return days.length === 0 || (days.length === 1 && days[0] === own) ? 'week' : 'custom';
}
