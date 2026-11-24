/**
 * A sync belongs to the workspace it runs for.
 *
 * It saves into that workspace's database, whichever workspace a window shows,
 * and tells the window what it saved. A window that shows another workspace, or
 * has moved to one while the sync ran, takes none of it: not into the notes on
 * screen, not into the mirror they are saved to, not into its own database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllNotesMetadata } from '#lib/db/idb.js';
import { readNotesMirror } from '#lib/noteStorage.js';
import { notesStore } from './notes.svelte';
import { syncStore } from './sync.svelte';
import type { Note } from '#lib/types.js';
import { syncSnapshot, type SyncSnapshot } from '#lib/syncRecords.js';
import { TEST_WORKSPACE } from '../../tests/workspace';

const OTHER = 'workspace-other';

function note(id: string, title = id): Note {
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
		updatedAt: 1,
		reminder: null,
		labels: [],
		images: []
	};
}

/** Tell the window what a sync saved, the way the scheduler does. */
function showSynced(snapshot: SyncSnapshot, pid: string): Promise<void> {
	return (
		notesStore as unknown as {
			show(
				pid: string,
				synced: { snapshot: SyncSnapshot; decisions: Map<string, unknown> }
			): Promise<void>;
		}
	).show(pid, { snapshot, decisions: new Map() });
}

function snapshotOf(notes: Note[]) {
	return syncSnapshot({ notes });
}

beforeEach(() => {
	localStorage.clear();
	notesStore.notes = [];
	notesStore.labels = [];
	notesStore.loaded = true;
});

describe('what a sync saved reaches only a window showing its workspace', () => {
	it('is not shown by a window on another workspace', async () => {
		vi.spyOn(syncStore, 'activePid', 'get').mockReturnValue(TEST_WORKSPACE);

		await showSynced(snapshotOf([note('secret-1', 'from the other workspace')]), OTHER);

		expect(notesStore.notes).toEqual([]);
		expect(readNotesMirror(TEST_WORKSPACE)).toEqual([]);
		expect(await getAllNotesMetadata(TEST_WORKSPACE)).toEqual([]);
		vi.restoreAllMocks();
	});

	it('is shown by a window on that workspace, which saves nothing for it', async () => {
		vi.spyOn(syncStore, 'activePid', 'get').mockReturnValue(TEST_WORKSPACE);

		await showSynced(snapshotOf([note('mine-1', 'my own note')]), TEST_WORKSPACE);

		expect(notesStore.notes.map((n) => n.id)).toEqual(['mine-1']);
		// The sync saved it already; showing it is not a save.
		expect(await getAllNotesMetadata(TEST_WORKSPACE)).toEqual([]);
		expect(await getAllNotesMetadata(OTHER)).toEqual([]);
		vi.restoreAllMocks();
	});
});
