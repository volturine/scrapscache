import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as idb from '#lib/db/idb.js';
import { getAllNotesMetadata, getSyncOutboxKeys } from '#lib/db/idb.js';
import { readNotesMirror, readPendingNotes } from '#lib/noteStorage.js';
import type { Label, Note } from '#lib/types.js';
import { NoteSaving, type SavingHost } from './noteSaving';
import { syncScheduler } from './syncScheduler';
import { emptyWorkspace } from '../../tests/workspace';

const WORKSPACE = 'note-saving-alone';

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

/** A window as the saver sees it: what it shows, and what it was told. */
function window_(notes: Note[] = [], labels: Label[] = []) {
	const told: string[] = [];
	const host: SavingHost & { mirror: boolean } = {
		mirror: true,
		pid: () => WORKSPACE,
		notes: () => notes,
		labels: () => labels,
		mayMirror: () => host.mirror,
		failed: (context) => void told.push(`failed: ${context}`),
		saved: () => void told.push('saved')
	};
	return { host, told, notes };
}

describe('saving what a window changes, apart from the store that holds it', () => {
	beforeEach(async () => {
		localStorage.clear();
		await emptyWorkspace(WORKSPACE);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.spyOn(syncScheduler, 'changed').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('saves a note with its upload mark, says so, and asks for a sync of that workspace', async () => {
		const { host, told } = window_();
		const saving = new NoteSaving(host);

		await saving.saveNow(note('n1'));

		expect((await getAllNotesMetadata(WORKSPACE)).map(({ id }) => id)).toEqual(['n1']);
		expect(await getSyncOutboxKeys(WORKSPACE)).toContain('note:n1');
		expect(told).toEqual(['saved']);
		expect(syncScheduler.changed).toHaveBeenCalledWith(WORKSPACE);
		// Landed, so it is no longer waiting in the journal.
		expect(readPendingNotes(WORKSPACE)).toEqual({});
	});

	it('says when a save failed, keeps the note journaled, and tries again by itself', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const held = note('n1', 'Kept through a failed save');
		const { host, told } = window_([held]);
		const saving = new NoteSaving(host);
		vi.spyOn(idb, 'saveNote').mockRejectedValueOnce(new Error('Storage full'));

		await expect(saving.saveNow(held)).rejects.toThrow('Storage full');
		expect(told).toEqual(['failed: Could not save note n1']);
		expect(Object.keys(readPendingNotes(WORKSPACE))).toEqual(['n1']);

		await vi.advanceTimersByTimeAsync(1_500);
		await vi.waitFor(async () =>
			expect((await getAllNotesMetadata(WORKSPACE)).map(({ id }) => id)).toEqual(['n1'])
		);
		await vi.waitFor(() => expect(readPendingNotes(WORKSPACE)).toEqual({}));
		expect(told.at(-1)).toBe('saved');
		saving.forgetNotes();
	});

	it('writes the copy for a quicker start only while the window may', () => {
		const { host } = window_([note('n1')]);
		const saving = new NoteSaving(host);

		host.mirror = false;
		saving.mirrorToLS();
		expect(readNotesMirror(WORKSPACE)).toEqual([]);

		host.mirror = true;
		saving.mirrorToLS();
		expect(readNotesMirror(WORKSPACE).map(({ id }) => id)).toEqual(['n1']);
	});
});
