import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { putNote } from '#lib/db/idb.js';
import { readNotesMirror } from '#lib/noteStorage.js';
import type { Note } from '#lib/types.js';
import { notesStore } from './notes.svelte';
import { syncStore } from './sync.svelte';
import { TEST_WORKSPACE } from '../../tests/workspace';

type Internals = {
	otherWindowSynced(pid: unknown): void;
	staleWhileHidden: string | null;
	mirrorToLS(): void;
};
const internals = notesStore as unknown as Internals;

function note(id: string, title: string, updatedAt: number): Note {
	return {
		id,
		title,
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

function setVisibility(state: DocumentVisibilityState): void {
	vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
	window.dispatchEvent(new Event('visibilitychange'));
}

describe('a hidden window while another window syncs', () => {
	beforeEach(async () => {
		localStorage.clear();
		internals.staleWhileHidden = null;
		const before = note('n1', 'before', 1);
		notesStore.notes = [before];
		// What another window saved after its sync.
		await putNote(TEST_WORKSPACE, note('n1', 'saved elsewhere', 2));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		internals.staleWhileHidden = null;
	});

	it('reads nothing while hidden, and catches up once shown', async () => {
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		internals.otherWindowSynced(TEST_WORKSPACE);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(notesStore.notes.map((item) => item.title)).toEqual(['before']);

		setVisibility('visible');

		await vi.waitFor(() =>
			expect(notesStore.notes.map((item) => item.title)).toEqual(['saved elsewhere'])
		);
		expect(internals.staleWhileHidden).toBeNull();
	});

	it('re-reads at once when it is visible', async () => {
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
		internals.otherWindowSynced(TEST_WORKSPACE);
		await vi.waitFor(() =>
			expect(notesStore.notes.map((item) => item.title)).toEqual(['saved elsewhere'])
		);
	});

	it('ignores another workspace', async () => {
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		internals.otherWindowSynced('some-other-workspace');
		expect(internals.staleWhileHidden).toBeNull();
	});

	it('does not write its outdated notes to the mirror', () => {
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		internals.otherWindowSynced(TEST_WORKSPACE);
		internals.mirrorToLS();
		expect(readNotesMirror(TEST_WORKSPACE)).toEqual([]);
	});

	it('catches up before it syncs, so the flight never starts from outdated notes', async () => {
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		internals.otherWindowSynced(TEST_WORKSPACE);
		syncStore.account = createSyncIdentity();
		const snapshots: string[][] = [];
		vi.spyOn(syncStore, 'sync').mockImplementation(async (local) => {
			snapshots.push(local.notes.map((item) => item.title));
			return { success: true, snapshot: local };
		});

		await notesStore.syncWithCloudManual();

		expect(snapshots).toEqual([['saved elsewhere']]);
		expect(internals.staleWhileHidden).toBeNull();
	});
});
