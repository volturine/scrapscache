import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { trashCountdown } from '#lib/utils.js';
import { notesStore } from './notes.svelte';
import { syncStore } from './sync.svelte';

const DAY = 86_400_000;

function note(id: string, partial: Partial<Note> = {}): Note {
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
		reminder: null,
		labels: [],
		...partial
	};
}

describe('trash', () => {
	beforeEach(() => {
		localStorage.clear();
		const account = createSyncIdentity();
		const profile = { id: 'profile-trash', name: 'Trash', syncKey: account.syncKey, createdAt: 1 };
		syncStore.profiles = [profile];
		syncStore.activateProfile(profile);
		notesStore.notes = [];
		notesStore.labels = [];
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await notesStore.waitForPendingProfileWrites();
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
	});

	it('purges notes past their deadline or without a usable trash time, and keeps the rest', () => {
		const purged = vi
			.spyOn(
				notesStore as unknown as { persistDeletedNotes(ids: string[]): Promise<void> },
				'persistDeletedNotes'
			)
			.mockResolvedValue();
		const now = Date.now();
		notesStore.notes = [
			note('recent', { trashed: true, trashedAt: now - DAY }),
			note('due', { trashed: true, trashedAt: now - 7 * DAY }),
			note('missing', { trashed: true, trashedAt: null }),
			note('unusable', { trashed: true, trashedAt: Number.NaN }),
			note('active')
		];

		notesStore.purgeOldTrash();

		expect(purged).toHaveBeenCalledWith(['due', 'missing', 'unusable']);
	});

	it('restarts the countdown when a restored note goes back to the trash', () => {
		const start = new Date(2026, 9, 10, 10, 0).getTime();
		const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
		const created = notesStore.createNote({ title: 'Twice' });
		notesStore.trashNote(created.id);

		clock.mockReturnValue(start + 3 * DAY);
		notesStore.restoreNote(created.id);
		notesStore.trashNote(created.id);

		const again = notesStore.notes.find((item) => item.id === created.id)!;
		expect(trashCountdown(again.trashedAt, Date.now())).toEqual({
			label: 'Deletes in 7 days',
			soon: false
		});
	});
});
