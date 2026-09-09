import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	bulkPutLabels,
	bulkPutNotes,
	clearProfileNamespace,
	getAllLabels,
	getAllNotesMetadata,
	LOCAL_PROFILE_ID,
	markSyncOutbox,
	waitForDeviceWrites
} from '$lib/db/idb';
import { createSyncIdentity } from '$lib/syncPairing';
import { notesStore } from './notes.svelte';
import { syncStore } from './sync.svelte';
import type { Label, Note } from '$lib/types';

const PID = 'profile-adopting';

function note(id: string, updatedAt = 1): Note {
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
		updatedAt,
		reminder: null,
		labels: [],
		images: []
	};
}

function label(id: string, updatedAt = 1): Label {
	return { id, name: id, updatedAt } as Label;
}

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

describe('dropping a redundant anonymous workspace', () => {
	beforeEach(async () => {
		localStorage.clear();
		const account = createSyncIdentity();
		const profile = { id: PID, name: 'Adopting profile', syncKey: account.syncKey, createdAt: 1 };
		syncStore.profiles = [profile];
		syncStore.activateProfile(profile);
		syncStore.lastError = null;
		notesStore.notes = [];
		notesStore.labels = [];
		internals().lastPersistError = null;
		internals().attachmentHydrationFailures = new Set();

		await clearProfileNamespace(LOCAL_PROFILE_ID);
		await clearProfileNamespace(PID);
		// The state a device is left in after an adoption: the same rows in both.
		await bulkPutNotes(LOCAL_PROFILE_ID, [note('adopted-1'), note('adopted-2')]);
		await bulkPutLabels(LOCAL_PROFILE_ID, [label('label-1')]);
		await bulkPutNotes(PID, [note('adopted-1'), note('adopted-2')]);
		await bulkPutLabels(PID, [label('label-1')]);
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
		expect(await getAllLabels(LOCAL_PROFILE_ID)).toEqual([]);
		// The profile that owns the rows keeps them.
		expect((await getAllNotesMetadata(PID)).map((row) => row.id).sort()).toEqual([
			'adopted-1',
			'adopted-2'
		]);
	});

	it('heals a device duplicated by an earlier build, with nothing recorded', async () => {
		// No marker of any kind was ever written for this device: redundancy is
		// judged purely from the rows, which is what makes the healing retroactive.
		expect(localStorage.getItem('scrapscache-adopted-local-into')).toBeNull();

		await flushWith(true);

		expect(await localNoteIds()).toEqual([]);
	});

	it('keeps notes the user actually wrote in the anonymous workspace', async () => {
		await bulkPutNotes(LOCAL_PROFILE_ID, [note('anonymous-only')]);

		await flushWith(true);

		expect((await localNoteIds()).sort()).toEqual(['adopted-1', 'adopted-2', 'anonymous-only']);
	});

	it('keeps the copy when the anonymous version is newer than the synced one', async () => {
		await bulkPutNotes(LOCAL_PROFILE_ID, [note('adopted-1', 999)]);

		await flushWith(true);

		expect((await localNoteIds()).sort()).toEqual(['adopted-1', 'adopted-2']);
	});

	it('keeps a label the synced workspace does not have', async () => {
		await bulkPutLabels(LOCAL_PROFILE_ID, [label('anonymous-label')]);

		await flushWith(true);

		expect(await localNoteIds()).toEqual(['adopted-1', 'adopted-2']);
	});

	it('keeps the copy when the sync did not finish', async () => {
		await flushWith(false);

		expect((await localNoteIds()).sort()).toEqual(['adopted-1', 'adopted-2']);
	});

	it('keeps the copy when records are still queued in the outbox', async () => {
		await markSyncOutbox(PID, ['note:adopted-1']);

		await flushWith(true);

		expect((await localNoteIds()).sort()).toEqual(['adopted-1', 'adopted-2']);
	});

	it('keeps the copy when an attachment could not be read', async () => {
		internals().attachmentHydrationFailures = new Set(['adopted-1']);

		await flushWith(true);

		expect((await localNoteIds()).sort()).toEqual(['adopted-1', 'adopted-2']);
	});

	it('keeps the copy when the sync reported a quota error', async () => {
		syncStore.lastError = 'Storage quota exceeded';

		await flushWith(true);

		expect((await localNoteIds()).sort()).toEqual(['adopted-1', 'adopted-2']);
	});

	it('keeps the copy when a local write failed', async () => {
		internals().lastPersistError = 'Could not save note';

		await flushWith(true);

		expect((await localNoteIds()).sort()).toEqual(['adopted-1', 'adopted-2']);
	});

	it('retries on a later sync once the blocking condition clears', async () => {
		syncStore.lastError = 'Storage quota exceeded';
		await flushWith(true);
		expect((await localNoteIds()).sort()).toEqual(['adopted-1', 'adopted-2']);

		syncStore.lastError = null;
		await flushWith(true);

		expect(await localNoteIds()).toEqual([]);
	});

	it('never drops the anonymous workspace while it is the active one', async () => {
		syncStore.activateLocalWorkspace();

		await flushWith(true);

		expect((await localNoteIds()).sort()).toEqual(['adopted-1', 'adopted-2']);
	});
});
