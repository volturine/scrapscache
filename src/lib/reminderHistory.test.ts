import { describe, expect, it } from 'vitest';
import {
	isReminderHistoryEntry,
	mergeReminderHistory,
	reminderHistoryKey,
	reminderHistoryNoteId,
	type ReminderHistoryEntry
} from './reminderHistory';

const wake = 'a'.repeat(43);

function entry(parts: Partial<ReminderHistoryEntry> = {}): ReminderHistoryEntry {
	return { id: wake, noteId: 'note-1', firedAt: 100, ...parts };
}

describe('reminder history', () => {
	it('keeps the earliest fire and dismissal whichever device reports first', () => {
		const here = entry({ firedAt: 200 });
		const there = entry({ firedAt: 100, dismissedAt: 300 });
		expect(mergeReminderHistory([here], [there], {})).toEqual([
			entry({ firedAt: 100, dismissedAt: 300 })
		]);
		expect(mergeReminderHistory([there], [here], {})).toEqual(
			mergeReminderHistory([here], [there], {})
		);
	});

	it('forgets the history of a note deleted for good', () => {
		expect(mergeReminderHistory([entry()], [], { 'note-1': 5 })).toEqual([]);
	});

	it('finds the note a history record belongs to from its key alone', () => {
		const key = reminderHistoryKey(entry({ noteId: 'with:colon' }));
		expect(key).toBe(`reminder-history:with:colon:${wake}`);
		expect(reminderHistoryNoteId(key)).toBe('with:colon');
		expect(reminderHistoryNoteId('note:note-1')).toBeNull();
	});

	it('rejects malformed entries', () => {
		expect(isReminderHistoryEntry(entry())).toBe(true);
		expect(isReminderHistoryEntry(entry({ id: 'short' }))).toBe(false);
		expect(isReminderHistoryEntry(entry({ noteId: '' }))).toBe(false);
		expect(isReminderHistoryEntry(entry({ firedAt: 0 }))).toBe(false);
		expect(isReminderHistoryEntry(entry({ dismissedAt: Number.NaN }))).toBe(false);
	});
});
