/**
 * A sync flight belongs to the workspace it started in.
 *
 * Downloading, decrypting and applying takes time, and the window can be
 * switched to another workspace while it runs. Nothing a flight pulled may
 * land anywhere but the workspace it was pulled for — not in the database, not
 * in the notes on screen, not in the mirror they are saved to.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllNotesMetadata, LOCAL_PROFILE_ID } from '$lib/db/idb';
import { readNotesMirror } from '$lib/noteStorage';
import { notesStore } from './notes.svelte';
import { syncStore } from './sync.svelte';
import type { Note } from '$lib/types';

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
		applyPulledSnapshot: (
			snapshot: {
				notes: Note[];
				labels: never[];
				boards: never[];
				tombstones: Record<string, number>;
				labelTombstones: Record<string, number>;
				boardTombstones: Record<string, number>;
			},
			pid: string
		) => Promise<unknown>;
	}
).applyPulledSnapshot.bind(notesStore);

function snapshotOf(notes: Note[]) {
	return {
		notes,
		labels: [] as never[],
		boards: [] as never[],
		tombstones: {},
		labelTombstones: {},
		boardTombstones: {}
	};
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
		vi.spyOn(syncStore, 'activePid', 'get').mockReturnValue(LOCAL_PROFILE_ID);

		await applyPulled(snapshotOf([note('secret-1', 'from the other workspace')]), OTHER);

		expect(await getAllNotesMetadata(LOCAL_PROFILE_ID)).toEqual([]);
		expect(notesStore.notes).toEqual([]);
		expect(readNotesMirror(LOCAL_PROFILE_ID)).toEqual([]);
		vi.restoreAllMocks();
	});

	it('applies what it pulled for the workspace still on screen', async () => {
		vi.spyOn(syncStore, 'activePid', 'get').mockReturnValue(LOCAL_PROFILE_ID);

		await applyPulled(snapshotOf([note('mine-1', 'my own note')]), LOCAL_PROFILE_ID);

		expect((await getAllNotesMetadata(LOCAL_PROFILE_ID)).map((n) => n.id)).toEqual(['mine-1']);
		expect(notesStore.notes.map((n) => n.id)).toEqual(['mine-1']);
		vi.restoreAllMocks();
	});

	it('leaves the other workspace empty either way', async () => {
		vi.spyOn(syncStore, 'activePid', 'get').mockReturnValue(LOCAL_PROFILE_ID);

		await applyPulled(snapshotOf([note('secret-2')]), OTHER);
		await applyPulled(snapshotOf([note('mine-2')]), LOCAL_PROFILE_ID);

		expect(await getAllNotesMetadata(OTHER)).toEqual([]);
		vi.restoreAllMocks();
	});
});
