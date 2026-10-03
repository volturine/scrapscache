/**
 * A sync flight belongs to the workspace it started in.
 *
 * Downloading, decrypting and applying takes time, and the window can be
 * switched to another workspace while it runs. Nothing a flight pulled may
 * land anywhere but the workspace it was pulled for — not in the database, not
 * in the notes on screen, not in the mirror they are saved to.
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

/** Reach the private applier the way a flight does. */
function applyPulled(snapshot: Parameters<typeof callApply>[0], pid: string) {
	return callApply(snapshot, pid);
}
const callApply = (
	notesStore as unknown as {
		applyPulledSnapshot: (snapshot: SyncSnapshot, pid: string) => Promise<unknown>;
	}
).applyPulledSnapshot.bind(notesStore);

function snapshotOf(notes: Note[]) {
	return syncSnapshot({ notes });
}

beforeEach(() => {
	localStorage.clear();
	notesStore.notes = [];
	notesStore.labels = [];
});

describe('a sync flight cannot write into another workspace', () => {
	it('drops what it pulled when the window moved on', async () => {
		// The window is on the anonymous workspace; a flight for another one
		// finishes downloading and tries to apply.
		vi.spyOn(syncStore, 'activePid', 'get').mockReturnValue(TEST_WORKSPACE);

		await applyPulled(snapshotOf([note('secret-1', 'from the other workspace')]), OTHER);

		expect(await getAllNotesMetadata(TEST_WORKSPACE)).toEqual([]);
		expect(notesStore.notes).toEqual([]);
		expect(readNotesMirror(TEST_WORKSPACE)).toEqual([]);
		vi.restoreAllMocks();
	});

	it('applies what it pulled for the workspace still on screen', async () => {
		vi.spyOn(syncStore, 'activePid', 'get').mockReturnValue(TEST_WORKSPACE);

		await applyPulled(snapshotOf([note('mine-1', 'my own note')]), TEST_WORKSPACE);

		expect((await getAllNotesMetadata(TEST_WORKSPACE)).map((n) => n.id)).toEqual(['mine-1']);
		expect(notesStore.notes.map((n) => n.id)).toEqual(['mine-1']);
		vi.restoreAllMocks();
	});

	it('leaves the other workspace empty either way', async () => {
		vi.spyOn(syncStore, 'activePid', 'get').mockReturnValue(TEST_WORKSPACE);

		await applyPulled(snapshotOf([note('secret-2')]), OTHER);
		await applyPulled(snapshotOf([note('mine-2')]), TEST_WORKSPACE);

		expect(await getAllNotesMetadata(OTHER)).toEqual([]);
		vi.restoreAllMocks();
	});
});
