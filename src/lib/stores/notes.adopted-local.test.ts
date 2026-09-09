import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	bulkPutNotes,
	clearProfileNamespace,
	getAllNotesMetadata,
	LOCAL_PROFILE_ID,
	markSyncOutbox,
	waitForDeviceWrites
} from '$lib/db/idb';
import { adoptedLocalDataPid, markAdoptedLocalData } from '$lib/profiles';
import { createSyncIdentity } from '$lib/syncPairing';
import { notesStore } from './notes.svelte';
import { syncStore } from './sync.svelte';
import type { Note } from '$lib/types';

const PID = 'profile-adopting';

function note(id: string): Note {
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
		images: []
	};
}

/** Reach past queueSync so the gate is exercised without a real relay. */
type NotesInternals = {
	queueSync: (indicate?: boolean) => Promise<boolean>;
	lastPersistError: string | null;
	attachmentHydrationFailures: Set<string>;
	syncPushTimer: ReturnType<typeof setTimeout> | null;
	dirty: boolean;
};

function internals(): NotesInternals {
	return notesStore as unknown as NotesInternals;
}

describe('dropping the adopted anonymous workspace', () => {
	beforeEach(async () => {
		localStorage.clear();
		const account = createSyncIdentity();
		const profile = {
			id: PID,
			name: 'Adopting profile',
			syncKey: account.syncKey,
			createdAt: 1
		};
		syncStore.profiles = [profile];
		syncStore.activateProfile(profile);
		syncStore.lastError = null;
		notesStore.notes = [];
		notesStore.labels = [];
		internals().lastPersistError = null;
		internals().attachmentHydrationFailures = new Set();

		// The anonymous workspace still holds the rows the profile adopted.
		await clearProfileNamespace(LOCAL_PROFILE_ID);
		await clearProfileNamespace(PID);
		await bulkPutNotes(LOCAL_PROFILE_ID, [note('adopted-1')]);
		await bulkPutNotes(PID, [note('adopted-1')]);
		markAdoptedLocalData(PID);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		const state = internals();
		if (state.syncPushTimer) clearTimeout(state.syncPushTimer);
		state.syncPushTimer = null;
		state.dirty = false;
		syncStore.account = null;
		syncStore.profiles = [];
		notesStore.notes = [];
		await clearProfileNamespace(LOCAL_PROFILE_ID);
		await clearProfileNamespace(PID);
	});

	async function flushWith(synced: boolean): Promise<void> {
		vi.spyOn(internals(), 'queueSync').mockResolvedValue(synced);
		await notesStore.flushSync();
		await waitForDeviceWrites(LOCAL_PROFILE_ID);
	}

	async function localNoteIds(): Promise<string[]> {
		return (await getAllNotesMetadata(LOCAL_PROFILE_ID)).map((row) => row.id);
	}

	it('drops the copy once the sync is clean and nothing is left queued', async () => {
		await flushWith(true);

		expect(await localNoteIds()).toEqual([]);
		expect(adoptedLocalDataPid()).toBeNull();
		// The profile that adopted the rows keeps them.
		expect((await getAllNotesMetadata(PID)).map((row) => row.id)).toEqual(['adopted-1']);
	});

	it('keeps the copy when the sync did not finish', async () => {
		await flushWith(false);

		expect(await localNoteIds()).toEqual(['adopted-1']);
		expect(adoptedLocalDataPid()).toBe(PID);
	});

	it('keeps the copy when records are still queued in the outbox', async () => {
		await markSyncOutbox(PID, ['note:adopted-1']);

		await flushWith(true);

		expect(await localNoteIds()).toEqual(['adopted-1']);
		expect(adoptedLocalDataPid()).toBe(PID);
	});

	it('keeps the copy when an attachment could not be read', async () => {
		internals().attachmentHydrationFailures = new Set(['adopted-1']);

		await flushWith(true);

		expect(await localNoteIds()).toEqual(['adopted-1']);
		expect(adoptedLocalDataPid()).toBe(PID);
	});

	it('keeps the copy when the sync reported a quota error', async () => {
		syncStore.lastError = 'Storage quota exceeded';

		await flushWith(true);

		expect(await localNoteIds()).toEqual(['adopted-1']);
		expect(adoptedLocalDataPid()).toBe(PID);
	});

	it('keeps the copy when a local write failed', async () => {
		internals().lastPersistError = 'Could not save note';

		await flushWith(true);

		expect(await localNoteIds()).toEqual(['adopted-1']);
		expect(adoptedLocalDataPid()).toBe(PID);
	});

	it('retries on a later sync once the blocking condition clears', async () => {
		syncStore.lastError = 'Storage quota exceeded';
		await flushWith(true);
		expect(await localNoteIds()).toEqual(['adopted-1']);

		syncStore.lastError = null;
		await flushWith(true);

		expect(await localNoteIds()).toEqual([]);
		expect(adoptedLocalDataPid()).toBeNull();
	});

	it('never touches the anonymous workspace when no adoption is pending', async () => {
		localStorage.removeItem('scrapscache-adopted-local-into');

		await flushWith(true);

		expect(await localNoteIds()).toEqual(['adopted-1']);
	});

	it('never drops the anonymous workspace while it is the active namespace', async () => {
		syncStore.activateLocalWorkspace();
		markAdoptedLocalData(LOCAL_PROFILE_ID);

		await flushWith(true);

		expect(await localNoteIds()).toEqual(['adopted-1']);
	});
});
