import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { waitForDeviceWrites } from '$lib/db/idb';
import { BackupImportMode } from '$lib/backup';
import { notesStore } from './notes.svelte';
import { syncStore } from './sync.svelte';

function keepNote(overrides: Record<string, unknown> = {}) {
	return {
		color: 'DEFAULT',
		isTrashed: false,
		isPinned: false,
		isArchived: false,
		title: 'Imported',
		textContent: 'From Keep',
		userEditedTimestampUsec: 1_700_000_000_000_000,
		createdTimestampUsec: 1_600_000_000_000_000,
		...overrides
	};
}

describe('Google Keep takeout import', () => {
	beforeEach(() => {
		localStorage.clear();
		syncStore.account = null;
		notesStore.notes = [];
		notesStore.labels = [{ id: 'existing-recipes', name: 'Recipes', createdAt: 1, updatedAt: 1 }];
	});

	afterEach(() => {
		const internals = notesStore as unknown as {
			dirty: boolean;
			syncPushTimer: ReturnType<typeof setTimeout> | null;
		};
		if (internals.syncPushTimer) clearTimeout(internals.syncPushTimer);
		internals.syncPushTimer = null;
		internals.dirty = false;
		notesStore.notes = [];
		notesStore.labels = [];
	});

	it('adds Keep notes and reuses labels with the same name', async () => {
		const files = {
			'Takeout/Keep/Note.json': strToU8(
				JSON.stringify(
					keepNote({
						title: 'Cake',
						labels: [{ name: 'recipes' }, { name: 'Baking' }]
					})
				)
			)
		};

		const result = await notesStore.importKeepTakeout(files, BackupImportMode.Keep);
		await waitForDeviceWrites();

		expect(result).toEqual({ success: true });
		expect(notesStore.notes.map((note) => note.title)).toEqual(['Cake']);
		expect(notesStore.notes[0]).toMatchObject({
			body: 'From Keep',
			createdAt: 1_600_000_000_000,
			updatedAt: 1_700_000_000_000,
			labels: expect.arrayContaining(['existing-recipes'])
		});
		expect(notesStore.labels.map((label) => label.name).sort()).toEqual(['Baking', 'Recipes']);
	});

	it('replaces local notes without touching unmatched keep timestamps', async () => {
		notesStore.notes = [
			{
				id: 'old',
				title: 'Old',
				body: '',
				color: 'default',
				pinned: false,
				archived: false,
				trashed: false,
				trashedAt: null,
				createdAt: 1,
				updatedAt: 1,
				reminder: null,
				labels: []
			}
		];

		const result = await notesStore.importKeepTakeout(
			{
				'Takeout/Keep/Note.json': strToU8(JSON.stringify(keepNote({ title: 'New' })))
			},
			BackupImportMode.Replace
		);
		await waitForDeviceWrites();

		expect(result).toEqual({ success: true });
		expect(notesStore.notes.map((note) => note.title)).toEqual(['New']);
		expect(notesStore.notes[0].id).not.toBe('old');
		expect(notesStore.deletedNoteIds.old).toEqual(expect.any(Number));
	});
});
