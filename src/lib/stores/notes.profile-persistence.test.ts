import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAllNotesMetadata, getSyncOutboxKeys, waitForDeviceWrites } from '#lib/db/idb.js';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { notesStore } from './notes.svelte';
import { syncStore } from './sync.svelte';
import { TEST_WORKSPACE } from '../../tests/workspace';

describe('profile-scoped note persistence', () => {
	beforeEach(() => {
		localStorage.clear();
		const account = createSyncIdentity();
		const profile = {
			id: 'profile-notes',
			name: 'Notes profile',
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
	});

	it('stores ordinary edits and their outbox markers only in the active profile', async () => {
		const created = notesStore.createNote({ title: 'Scoped note' });

		await waitForDeviceWrites('profile-notes');

		expect((await getAllNotesMetadata('profile-notes')).map((note) => note.id)).toEqual([
			created.id
		]);
		expect(await getAllNotesMetadata(TEST_WORKSPACE)).toEqual([]);
		expect(await getSyncOutboxKeys('profile-notes')).toEqual([`note:${created.id}`]);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
	});
});
