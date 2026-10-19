import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { noteActivity } from '#lib/utils.js';
import { notesStore } from './notes.svelte';
import { syncStore } from './sync.svelte';

describe('createNote', () => {
	beforeEach(() => {
		localStorage.clear();
		const account = createSyncIdentity();
		const profile = {
			id: 'profile-create',
			name: 'Create',
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
	});

	it('reads as created until the first edit', () => {
		const created = notesStore.createNote({ title: 'Fresh', labels: [], reminder: null });

		expect(created.updatedAt).toBe(created.createdAt);
		expect(new Set(Object.values(created.fieldTimes ?? {}))).toEqual(new Set([created.createdAt]));
		expect(noteActivity(created, created.createdAt).label).toBe('Created just now');

		notesStore.updateNote(created.id, { title: 'Renamed' });
		const edited = notesStore.notes.find((note) => note.id === created.id)!;
		expect(edited.updatedAt).toBeGreaterThan(edited.createdAt);
		expect(noteActivity(edited, edited.updatedAt).label).toBe('Edited just now');
	});
});
