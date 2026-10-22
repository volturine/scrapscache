import { afterEach, describe, expect, it } from 'vitest';
import type { Note } from '#lib/types.js';
import { appClock, tickAppClock } from '#lib/appClock.svelte.js';
import { localTimeZone } from '#lib/model/index.js';
import { notesStore } from './notes.svelte';

function note(partial: Partial<Note>): Note {
	return {
		id: 'note',
		title: '',
		body: '',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		...partial
	};
}

const started = appClock.now;

afterEach(() => {
	notesStore.notes = [];
	tickAppClock(started);
});

describe('notesStore.notesWithReminders', () => {
	it('moves a repeating reminder down once its time has come', () => {
		tickAppClock(new Date(2026, 9, 22, 8, 0).getTime());
		notesStore.notes = [
			note({ id: 'once', reminder: new Date(2026, 9, 22, 14, 0).getTime() }),
			note({
				id: 'daily',
				reminder: new Date(2026, 9, 22, 9, 0).getTime(),
				repeat: { unit: 'day', every: 1, zone: localTimeZone() }
			})
		];
		expect(notesStore.notesWithReminders.map((found) => found.id)).toEqual(['daily', 'once']);

		// 9:00 fires; the daily one now comes tomorrow, after today's 14:00.
		tickAppClock(new Date(2026, 9, 22, 9, 1).getTime());
		expect(notesStore.notesWithReminders.map((found) => found.id)).toEqual(['once', 'daily']);
	});
});
