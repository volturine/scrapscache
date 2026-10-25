import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { tickAppClock } from '#lib/appClock.svelte.js';
import { localTimeZone } from '#lib/model/index.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { reminderStore } from '#lib/stores/reminders.svelte.js';
import { uiStore } from '#lib/stores/ui.svelte.js';
import RemindersView from './RemindersView.svelte';

// Sunday 25 October 2026, 10:30 local time.
const NOW = new Date(2026, 9, 25, 10, 30).getTime();

function at(month: number, day: number, hour: number, minute = 0): number {
	return new Date(2026, month - 1, day, hour, minute).getTime();
}

function note(id: string, reminder: number | null, partial: Partial<Note> = {}): Note {
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
		reminder,
		labels: [],
		...partial
	};
}

const openNote = vi.fn();
const navigation = vi.hoisted(() => ({ goto: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => navigation);
vi.mock('#lib/editorContext.js', () => ({
	useEditorActions: () => ({ startNewNote: vi.fn(), openNote, closeNote: vi.fn() })
}));

function headings(): string[] {
	return screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent?.trim());
}

describe('RemindersView', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		tickAppClock(NOW);
		notesStore.labels = [{ id: 'work', name: 'Work', createdAt: 1, updatedAt: 1 }];
		notesStore.notes = [
			note('Call dentist', at(10, 24, 9, 42)),
			note('Send invoice', at(10, 25, 16), { labels: ['work'], body: 'October hours' }),
			note('Water plants', at(10, 18, 18), {
				repeat: { unit: 'week', every: 1, zone: localTimeZone() }
			}),
			note('Renew domain', at(11, 12, 10)),
			note('No reminder', null)
		];
	});

	afterEach(() => {
		uiStore.reminderFilter = null;
		uiStore.clearSearch();
		notesStore.notes = [];
		notesStore.labels = [];
		openNote.mockClear();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('groups the reminders, soonest first, with their times and labels', () => {
		render(RemindersView);
		expect(headings()).toEqual(['Overdue', 'Today', 'Later']);
		const today = screen.getByRole('region', { name: 'Today' });
		const rows = within(today).getAllByRole('listitem');
		expect(rows.map((row) => row.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'4:00 PM Send invoice 4:00 PM October hours Work Done Snooze',
			'6:00 PM Weekly Water plants 6:00 PM · Weekly Skip Snooze'
		]);
		expect(
			within(screen.getByRole('region', { name: 'Overdue' })).getByRole('button', {
				name: 'Open Call dentist, overdue reminder Sat 9:42 AM, yesterday'
			})
		).toBeTruthy();
	});

	it('opens the note from its row', async () => {
		render(RemindersView);
		await fireEvent.click(screen.getByRole('button', { name: /^Open Send invoice,/ }));
		expect(openNote).toHaveBeenCalledWith('Send invoice');
	});

	it('shows a picked day by its date, says when it is empty, and what comes next', async () => {
		uiStore.reminderFilter = { from: '2026-10-29', to: '2026-10-29' };
		render(RemindersView);
		expect(headings()).toEqual(['Overdue', 'Thu, Oct 29', 'Next up']);
		expect(screen.getByText('Nothing on this day.')).toBeTruthy();
		const nextUp = screen.getByRole('region', { name: 'Next up' });
		expect(
			within(nextUp)
				.getAllByRole('listitem')
				.map((row) => row.textContent)
		).toEqual([expect.stringContaining('Water plants'), expect.stringContaining('Renew domain')]);
	});

	it('finishes a one-off reminder from its row, and skips one time of a repeat', async () => {
		const finish = vi.spyOn(notesStore, 'finishReminder').mockImplementation(() => {});
		const skip = vi.spyOn(notesStore, 'skipReminderTime').mockImplementation(() => {});
		const sync = vi.spyOn(reminderStore, 'sync').mockImplementation(() => {});
		render(RemindersView);
		await fireEvent.click(screen.getByRole('button', { name: 'Done with Send invoice' }));
		expect(finish).toHaveBeenCalledWith('Send invoice');
		await fireEvent.click(screen.getByRole('button', { name: 'Skip this time of Water plants' }));
		expect(skip).toHaveBeenCalledWith('Water plants', at(10, 25, 18));
		expect(sync).toHaveBeenCalledTimes(2);
		expect(openNote).not.toHaveBeenCalled();
	});

	it('snoozes from the row to a little later', async () => {
		// The menu opens on real timers; the agenda's clock is pinned by tickAppClock.
		vi.useRealTimers();
		const snooze = vi.spyOn(notesStore, 'snoozeReminder').mockImplementation(() => {});
		vi.spyOn(reminderStore, 'sync').mockImplementation(() => {});
		render(RemindersView);
		await fireEvent.click(screen.getByRole('button', { name: 'Snooze Call dentist' }));
		const menu = await screen.findByRole('menu', { name: 'Snooze Call dentist' });
		expect(
			within(menu)
				.getAllByRole('menuitem')
				.map((item) => item.textContent?.trim())
		).toEqual(['In 10 minutes', 'In 1 hour', 'Tomorrow, 8:00 AM', 'Pick a time…']);
		const item = within(menu).getByRole('menuitem', { name: 'In 1 hour' });
		await fireEvent.pointerDown(item, { pointerType: 'mouse' });
		await fireEvent.click(item);
		expect(snooze).toHaveBeenCalledWith('Call dentist', at(10, 24, 9, 42), NOW + 3_600_000);
	});

	it('explains an empty view', () => {
		notesStore.notes = [note('No reminder', null)];
		render(RemindersView);
		expect(
			screen.getByText('Create a note, then add a reminder when you need to return to it.')
		).toBeTruthy();
		expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
	});
});
