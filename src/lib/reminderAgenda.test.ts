import { describe, expect, it } from 'vitest';
import type { Note } from '#lib/types.js';
import { localTimeZone } from '#lib/model/index.js';
import {
	agendaGroups,
	agendaPreview,
	agendaTime,
	NEXT_UP_LIMIT,
	pickedDayGroups
} from './reminderAgenda.js';

// Sunday 25 October 2026, 10:30 local time: the last day of its week.
const NOW = new Date(2026, 9, 25, 10, 30).getTime();

function at(month: number, day: number, hour: number, minute = 0, year = 2026): number {
	return new Date(year, month - 1, day, hour, minute).getTime();
}

function note(id: string, reminder: number, partial: Partial<Note> = {}): Note {
	return {
		id,
		title: id,
		body: '',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		labels: [],
		reminder,
		...partial
	};
}

const weekly = { unit: 'week', every: 1, zone: localTimeZone() } as const;

const notes = [
	note('library', at(10, 23, 18)),
	note('dentist', at(10, 24, 9, 42)),
	note('invoice', at(10, 25, 16)),
	// Weekly since Sunday 18 October: listed for today at 18:00, never overdue.
	note('plants', at(10, 18, 18), { repeat: weekly }),
	note('landlord', at(10, 26, 11, 30)),
	note('passport', at(10, 29, 8, 42)),
	note('gifts', at(10, 31, 23, 42)),
	note('domain', at(11, 12, 10))
];

const ids = (entries: { note: Note }[]) => entries.map((entry) => entry.note.id);

describe('agendaGroups', () => {
	it('groups what is due, soonest first, and leaves empty groups out', () => {
		const groups = agendaGroups(notes, NOW);
		expect(groups.map((group) => [group.id, group.label, ids(group.entries)])).toEqual([
			['overdue', 'Overdue', ['library', 'dentist']],
			['today', 'Today', ['invoice', 'plants']],
			['tomorrow', 'Tomorrow', ['landlord']],
			// A Sunday has no more of this week, so the coming days are next week's.
			['nextWeek', 'Next week', ['passport', 'gifts']],
			['later', 'Later', ['domain']]
		]);
		expect(groups[1].date).toBe('Sun, Oct 25');
		expect(groups[2].date).toBe('Mon, Oct 26');
		expect(groups[0].date).toBeUndefined();
	});

	it('keeps the rest of the week apart from the next one, Monday to Sunday', () => {
		const wednesday = new Date(2026, 9, 21, 9).getTime();
		const groups = agendaGroups(
			[note('fri', at(10, 23, 9)), note('sun', at(10, 25, 9)), note('mon', at(10, 26, 9))],
			wednesday
		);
		expect(groups.map((group) => [group.label, ids(group.entries)])).toEqual([
			['This week', ['fri', 'sun']],
			['Next week', ['mon']]
		]);
	});

	it('lists a repeating reminder at its next time', () => {
		const [group] = agendaGroups([note('plants', at(10, 18, 18), { repeat: weekly })], NOW);
		expect(group.id).toBe('today');
		expect(group.entries[0].at).toBe(at(10, 25, 18));
	});
});

describe('pickedDayGroups', () => {
	it('shows the picked day between what is overdue and what comes next', () => {
		const groups = pickedDayGroups(notes, { from: '2026-10-29', to: '2026-10-29' }, NOW);
		expect(groups.map((group) => [group.id, group.label, ids(group.entries)])).toEqual([
			['overdue', 'Overdue', ['library', 'dentist']],
			['picked', 'Thu, Oct 29', ['passport']],
			['nextUp', 'Next up', ['gifts', 'plants', 'domain']]
		]);
	});

	it('names a range and lists each day a repeat comes on', () => {
		const daily = note('water', at(10, 20, 8), {
			repeat: { unit: 'day', every: 1, zone: localTimeZone() }
		});
		const groups = pickedDayGroups([daily], { from: '2026-10-29', to: '2026-10-31' }, NOW);
		const picked = groups.find((group) => group.id === 'picked');
		expect(picked?.label).toBe('Oct 29 – Oct 31');
		expect(picked?.entries.map((entry) => entry.at)).toEqual([
			at(10, 29, 8),
			at(10, 30, 8),
			at(10, 31, 8)
		]);
	});

	it('keeps an empty picked day so the view can say so, and caps what follows', () => {
		const many = Array.from({ length: 8 }, (_, i) => note(`n${i}`, at(12, 1 + i, 9)));
		const groups = pickedDayGroups(many, { from: '2026-11-03', to: null }, NOW);
		expect(groups.map((group) => group.id)).toEqual(['picked', 'nextUp']);
		expect(groups[0].entries).toEqual([]);
		expect(groups[1].entries).toHaveLength(NEXT_UP_LIMIT);
	});
});

describe('agendaTime', () => {
	const entry = (ms: number, partial: Partial<Note> = {}) => ({
		note: note('n', ms, partial),
		at: ms
	});

	it('leaves out what the group already says', () => {
		expect(agendaTime(entry(at(10, 25, 16)), 'today', NOW)).toMatchObject({
			time: '4:00 PM',
			detail: null,
			overdue: false
		});
		expect(agendaTime(entry(at(10, 29, 8, 42)), 'nextWeek', NOW).time).toBe('Thu 8:42 AM');
		expect(agendaTime(entry(at(11, 12, 10)), 'later', NOW).time).toBe('Nov 12, 10:00 AM');
		expect(agendaTime(entry(at(1, 3, 10, 0, 2027)), 'later', NOW).time).toBe(
			'Jan 3, 2027, 10:00 AM'
		);
	});

	it('says how late an overdue reminder is', () => {
		expect(agendaTime(entry(at(10, 23, 18)), 'overdue', NOW)).toMatchObject({
			time: 'Fri 6:00 PM',
			detail: '2 days overdue',
			overdue: true
		});
		expect(agendaTime(entry(at(10, 24, 9, 42)), 'overdue', NOW).detail).toBe('Yesterday');
		expect(agendaTime(entry(at(10, 25, 9)), 'overdue', NOW).detail).toBe('Earlier today');
	});

	it('says how often a repeat comes', () => {
		expect(agendaTime(entry(at(10, 25, 18), { repeat: weekly }), 'today', NOW)).toMatchObject({
			detail: 'Weekly',
			repeating: true,
			overdue: false
		});
	});

	it('names the weekday only when the picked days span more than one', () => {
		expect(agendaTime(entry(at(10, 29, 8, 42)), 'picked', NOW).time).toBe('8:42 AM');
		expect(agendaTime(entry(at(10, 29, 8, 42)), 'picked', NOW, true).time).toBe('Thu 8:42 AM');
	});
});

describe('agendaPreview', () => {
	it('gives the first body line without its marker, and nothing for a hidden preview', () => {
		expect(agendaPreview(note('n', NOW, { body: '\n- [ ] Milk\nEggs' }))).toBe('Milk');
		expect(agendaPreview(note('n', NOW, { body: 'Milk', secret: true }))).toBe('');
	});
});
