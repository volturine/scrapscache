import type { Note } from '#lib/types.js';
import {
	reminderNextAt,
	reminderShownAt,
	reminderTimesBetween,
	repeatShortLabel
} from '#lib/model/index.js';
import { plainLine } from '#lib/noteLine.js';
import { dayKey, dayKeySpan } from '#lib/utils.js';

const DAY_MS = 86_400_000;

/** A note on the agenda, at the time it is listed for. */
export type AgendaEntry = { note: Note; at: number };

export type AgendaGroupId =
	'overdue' | 'today' | 'tomorrow' | 'week' | 'nextWeek' | 'later' | 'picked' | 'nextUp';

export type AgendaGroup = {
	id: AgendaGroupId;
	label: string;
	/** The date a Today or Tomorrow heading stands for, at its right. */
	date?: string;
	entries: AgendaEntry[];
};

function startOfDay(ms: number): number {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function daysFrom(from: number, days: number): number {
	const d = new Date(from);
	d.setDate(d.getDate() + days);
	return d.getTime();
}

/** Monday 00:00 of the week `ms` is in; the calendar starts its weeks on Monday too. */
function startOfWeek(ms: number): number {
	const day = (new Date(ms).getDay() + 6) % 7;
	return daysFrom(startOfDay(ms), -day);
}

function dayHeading(ms: number): string {
	return new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function rangeHeading(from: string, to: string): string {
	const { start } = dayKeySpan(from);
	const { start: endStart } = dayKeySpan(to);
	const words = (ms: number) =>
		new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
	return `${words(start)} – ${words(endStart)}`;
}

function byTime(entries: AgendaEntry[]): AgendaEntry[] {
	return [...entries].sort((a, b) => a.at - b.at);
}

function entryOf(note: Note, now: number): AgendaEntry | null {
	const at = reminderShownAt(note, now);
	return at == null ? null : { note, at };
}

/**
 * The agenda's groups, soonest first: Overdue, Today, Tomorrow, the rest of this
 * week, next week, and later. Weeks run Monday to Sunday like the calendar. An
 * empty group is left out. A repeating reminder is listed at its next time, so it
 * is never overdue.
 */
export function agendaGroups(notes: Note[], now: number): AgendaGroup[] {
	const today = startOfDay(now);
	const tomorrow = daysFrom(today, 1);
	const dayAfter = daysFrom(today, 2);
	const nextWeek = daysFrom(startOfWeek(now), 7);
	const weekAfter = daysFrom(nextWeek, 7);
	const buckets: Record<Exclude<AgendaGroupId, 'picked' | 'nextUp'>, AgendaEntry[]> = {
		overdue: [],
		today: [],
		tomorrow: [],
		week: [],
		nextWeek: [],
		later: []
	};
	for (const note of notes) {
		const entry = entryOf(note, now);
		if (!entry) continue;
		const { at } = entry;
		if (at < now) buckets.overdue.push(entry);
		else if (at < tomorrow) buckets.today.push(entry);
		else if (at < dayAfter) buckets.tomorrow.push(entry);
		else if (at < nextWeek) buckets.week.push(entry);
		else if (at < weekAfter) buckets.nextWeek.push(entry);
		else buckets.later.push(entry);
	}
	const groups: AgendaGroup[] = [
		{ id: 'overdue', label: 'Overdue', entries: byTime(buckets.overdue) },
		{ id: 'today', label: 'Today', date: dayHeading(today), entries: byTime(buckets.today) },
		{
			id: 'tomorrow',
			label: 'Tomorrow',
			date: dayHeading(tomorrow),
			entries: byTime(buckets.tomorrow)
		},
		{ id: 'week', label: 'This week', entries: byTime(buckets.week) },
		{ id: 'nextWeek', label: 'Next week', entries: byTime(buckets.nextWeek) },
		{ id: 'later', label: 'Later', entries: byTime(buckets.later) }
	];
	return groups.filter((group) => group.entries.length > 0);
}

/** How many of the picked days' reminders are listed after them. */
export const NEXT_UP_LIMIT = 5;

/**
 * The agenda for picked days: what is overdue, then the days themselves (named by
 * date, kept even when empty so the view can say so), then the next few after
 * them. A repeating reminder is in the picked days on each day it comes.
 */
export function pickedDayGroups(
	notes: Note[],
	picked: { from: string; to: string | null },
	now: number
): AgendaGroup[] {
	const to = picked.to ?? picked.from;
	const { start, end } = dayKeySpan(picked.from, to);
	const pickedEntries: AgendaEntry[] = [];
	const overdue: AgendaEntry[] = [];
	const after: AgendaEntry[] = [];
	for (const note of notes) {
		const times = reminderTimesBetween(note, start, end);
		if (times.length > 0) {
			for (const at of times) pickedEntries.push({ note, at });
			continue;
		}
		if (note.reminder == null) continue;
		if (note.repeat) {
			// A repeat is next up at its first time after the picked days.
			const next = reminderNextAt(note, end);
			if (next != null) after.push({ note, at: next });
		} else if (note.reminder < now) {
			overdue.push({ note, at: note.reminder });
		} else if (note.reminder > end) {
			after.push({ note, at: note.reminder });
		}
	}
	const label = picked.from === to ? dayHeading(start) : rangeHeading(picked.from, to);
	const groups: AgendaGroup[] = [];
	if (overdue.length > 0)
		groups.push({ id: 'overdue', label: 'Overdue', entries: byTime(overdue) });
	groups.push({ id: 'picked', label, entries: byTime(pickedEntries) });
	if (after.length > 0) {
		groups.push({ id: 'nextUp', label: 'Next up', entries: byTime(after).slice(0, NEXT_UP_LIMIT) });
	}
	return groups;
}

export type AgendaTime = {
	/** The time, with as much of the date as the group leaves unsaid. */
	time: string;
	/** How late, or how often. */
	detail: string | null;
	overdue: boolean;
	repeating: boolean;
};

function overdueWords(at: number, now: number): string {
	const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
	if (days <= 0) return 'Earlier today';
	if (days === 1) return 'Yesterday';
	return `${days} days overdue`;
}

/**
 * The words a row shows for its time, given which group it is in: a group named
 * for one day leaves the day out, one spanning days names the weekday, and Later
 * gives the date. `multiDay` says the picked group spans more than one day.
 */
export function agendaTime(
	entry: AgendaEntry,
	group: AgendaGroupId,
	now: number,
	multiDay = false
): AgendaTime {
	const date = new Date(entry.at);
	const clock = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	const overdue = group === 'overdue';
	const repeat = entry.note.repeat;
	let time: string;
	if (group === 'today' || group === 'tomorrow' || (group === 'picked' && !multiDay)) {
		time = clock;
	} else if (group === 'week' || group === 'nextWeek' || group === 'picked' || overdue) {
		const weekday = date.toLocaleDateString([], { weekday: 'short' });
		time = `${weekday} ${clock}`;
	} else {
		const sameYear = date.getFullYear() === new Date(now).getFullYear();
		const day = date.toLocaleDateString([], {
			month: 'short',
			day: 'numeric',
			...(sameYear ? {} : { year: 'numeric' })
		});
		time = `${day}, ${clock}`;
	}
	const detail = overdue
		? overdueWords(entry.at, now)
		: repeat
			? repeatShortLabel(entry.at, repeat)
			: null;
	return { time, detail, overdue, repeating: Boolean(repeat) };
}

/** The first line of the body, for a row under its title; nothing for a hidden preview. */
export function agendaPreview(note: Note): string {
	if (note.secret) return '';
	for (const raw of note.body.split('\n')) {
		const line = plainLine(raw);
		if (line) return line;
	}
	return '';
}
