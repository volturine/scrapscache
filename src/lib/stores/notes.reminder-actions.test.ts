import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { localTimeZone } from '#lib/model/index.js';
import { actionUndo } from './actionUndo.svelte';
import { notesStore } from './notes.svelte';
import { syncStore } from './sync.svelte';

const HOUR = 3_600_000;
const weekly = { unit: 'week', every: 1, zone: localTimeZone() } as const;

describe('Done, Skip and Snooze on a reminder', () => {
	beforeEach(() => {
		localStorage.clear();
		actionUndo.clear();
		const account = createSyncIdentity();
		const profile = {
			id: 'profile-reminder-actions',
			name: 'Reminder actions',
			syncKey: account.syncKey,
			createdAt: 1
		};
		syncStore.profiles = [profile];
		syncStore.activateProfile(profile);
		notesStore.notes = [];
		notesStore.labels = [];
	});

	afterEach(() => {
		const internals = notesStore as unknown as {
			dirty: boolean;
			syncPushTimer: ReturnType<typeof setTimeout> | null;
		};
		if (internals.syncPushTimer) clearTimeout(internals.syncPushTimer);
		internals.syncPushTimer = null;
		internals.dirty = false;
		syncStore.account = null;
		syncStore.profiles = [];
		notesStore.notes = [];
		notesStore.labels = [];
		actionUndo.clear();
	});

	function note(id: string) {
		return notesStore.notes.find((item) => item.id === id);
	}

	it('takes a one-off reminder away, keeps the note, and Undo brings it back', () => {
		const at = Date.now() - HOUR;
		const created = notesStore.createNote({ title: 'Bins', reminder: at });

		notesStore.finishReminder(created.id);

		expect(note(created.id)).toMatchObject({ reminder: null, trashed: false, archived: false });
		expect(actionUndo.bar).toBe('Reminder done');

		actionUndo.undo();
		expect(note(created.id)?.reminder).toBe(at);
	});

	it('skips one time of a repeating reminder rather than ending it', () => {
		const first = Date.now() + HOUR;
		const created = notesStore.createNote({ title: 'Plants', reminder: first });
		notesStore.setReminder(created.id, first, weekly);
		actionUndo.clear();

		notesStore.finishReminder(created.id);
		expect(note(created.id)?.reminder).toBe(first);

		notesStore.skipReminderTime(created.id, first);
		expect(note(created.id)?.repeat).toMatchObject({ ...weekly, skipUntil: first });
		expect(actionUndo.bar).toBe('Skipped this time');

		actionUndo.undo();
		expect(note(created.id)?.repeat).toEqual(weekly);
	});

	it('snoozes a one-off reminder to the new time, and a repeat for this time only', () => {
		const once = notesStore.createNote({ title: 'Call', reminder: Date.now() - HOUR });
		const later = Date.now() + HOUR;
		notesStore.snoozeReminder(once.id, once.reminder as number, later);
		expect(note(once.id)?.reminder).toBe(later);

		const first = Date.now() + HOUR;
		const repeating = notesStore.createNote({ title: 'Plants', reminder: first });
		notesStore.setReminder(repeating.id, first, weekly);
		notesStore.snoozeReminder(repeating.id, first, first + HOUR);
		expect(note(repeating.id)?.repeat).toMatchObject({
			...weekly,
			skipUntil: first,
			moved: first + HOUR
		});
		expect(note(repeating.id)?.reminder).toBe(first);
		// Snoozing records nothing to undo: the same row can move it again.
		expect(actionUndo.past).toHaveLength(0);
	});
});
