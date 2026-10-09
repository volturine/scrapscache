/**
 * A save journals only the note it changes. The fast-boot mirror of every note
 * is written once edits pause, and an edit whose IndexedDB write never landed
 * still comes back on the next boot.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as idb from '#lib/db/idb.js';
import { clearAllNotes, getAllNotesMetadata } from '#lib/db/idb.js';
import {
	journalPendingNotes,
	NOTES_MIRROR_KEY,
	PENDING_NOTES_KEY,
	readPendingNotes
} from '#lib/noteStorage.js';
import type { Note } from '#lib/types.js';
import { notesStore } from './notes.svelte';
import { TEST_WORKSPACE } from '../../tests/workspace';

function note(id: string): Note {
	return {
		id,
		title: `Note ${id}`,
		body: 'x'.repeat(200),
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

const MIRROR = `${NOTES_MIRROR_KEY}:${TEST_WORKSPACE}`;
const PENDING = `${PENDING_NOTES_KEY}:${TEST_WORKSPACE}`;

function writesTo(setItem: { mock: { calls: unknown[][] } }, key: string): string[] {
	return setItem.mock.calls
		.filter(([written]) => written === key)
		.map(([, value]) => String(value));
}

beforeEach(async () => {
	localStorage.clear();
	await clearAllNotes(TEST_WORKSPACE);
	notesStore.notes = Array.from({ length: 500 }, (_, index) => note(`n${index}`));
	notesStore.labels = [];
	notesStore.deletedNoteIds = {};
	notesStore.deletedLabelIds = {};
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('saving a note', () => {
	it('journals only that note, and mirrors every note once for many saves', async () => {
		vi.useFakeTimers();
		const setItem = vi.spyOn(Storage.prototype, 'setItem');

		for (let index = 0; index < 20; index++)
			notesStore.updateNote('n7', { title: `edit ${index}` });

		expect(writesTo(setItem, MIRROR)).toEqual([]);
		const journaled = writesTo(setItem, PENDING);
		expect(journaled).toHaveLength(20);
		// Each journal write carries the one note, not the workspace.
		for (const value of journaled) expect(Object.keys(JSON.parse(value))).toEqual(['n7']);

		await vi.runAllTimersAsync();

		expect(writesTo(setItem, MIRROR)).toHaveLength(1);
		expect(JSON.parse(localStorage.getItem(MIRROR) ?? '[]')).toHaveLength(500);
		// Every write landed, so nothing is left pending.
		expect(readPendingNotes(TEST_WORKSPACE)).toEqual({});
		expect(localStorage.getItem(PENDING)).toBeNull();
	});

	it('waits for typing to pause before mirroring every note', async () => {
		vi.useFakeTimers();
		const setItem = vi.spyOn(Storage.prototype, 'setItem');

		// Steady typing: a save every second for half a minute.
		for (let index = 0; index < 30; index++) {
			notesStore.updateNote('n7', { title: `edit ${index}` });
			await vi.advanceTimersByTimeAsync(1_000);
		}
		expect(writesTo(setItem, MIRROR)).toEqual([]);

		await vi.advanceTimersByTimeAsync(2_000);
		expect(writesTo(setItem, MIRROR)).toHaveLength(1);
		expect(JSON.parse(localStorage.getItem(MIRROR) ?? '[]')[0]).toBeDefined();
	});

	it('mirrors at once when the page is hidden', () => {
		vi.useFakeTimers();
		notesStore.updateNote('n7', { title: 'typed, then switched away' });
		const setItem = vi.spyOn(Storage.prototype, 'setItem');
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

		window.dispatchEvent(new Event('visibilitychange'));

		expect(writesTo(setItem, MIRROR)).toHaveLength(1);
	});

	it('journals a label removal across its notes in one write', () => {
		vi.useFakeTimers();
		notesStore.labels = [{ id: 'l1', name: 'work', createdAt: 1, updatedAt: 1 }];
		notesStore.notes = notesStore.notes.map((item, index) =>
			index < 100 ? { ...item, labels: ['l1'] } : item
		);
		const setItem = vi.spyOn(Storage.prototype, 'setItem');

		notesStore.removeLabel('l1');

		expect(writesTo(setItem, MIRROR)).toEqual([]);
		const journaled = writesTo(setItem, PENDING);
		expect(journaled).toHaveLength(1);
		expect(Object.keys(JSON.parse(journaled[0]))).toHaveLength(100);
	});

	it('brings back an edit whose IndexedDB write never landed', async () => {
		notesStore.notes = [note('kept')];
		// The page dies before the write commits: it never resolves.
		vi.spyOn(idb, 'putNote').mockImplementationOnce(() => new Promise(() => undefined));

		notesStore.updateNote('kept', { title: 'typed just before the crash' });
		vi.restoreAllMocks();

		// The next boot of this workspace.
		expect(await getAllNotesMetadata(TEST_WORKSPACE)).toEqual([]);
		notesStore.notes = [];
		notesStore.loaded = false;
		await notesStore.init();

		expect(notesStore.notes.map(({ title }) => title)).toEqual(['typed just before the crash']);
		expect((await getAllNotesMetadata(TEST_WORKSPACE)).map(({ title }) => title)).toEqual([
			'typed just before the crash'
		]);
		// Replayed into IndexedDB, so the journal lets it go.
		expect(readPendingNotes(TEST_WORKSPACE)).toEqual({});
	});

	it("keeps another window's entry journaled while this one boots", async () => {
		notesStore.notes = [];
		notesStore.loaded = false;
		const read = idb.getAllNotesMetadata;
		// Another window saves while this boot waits on IndexedDB, after it read the journal.
		vi.spyOn(idb, 'getAllNotesMetadata').mockImplementationOnce(async (pid) => {
			journalPendingNotes([{ ...note('elsewhere'), title: 'still being written' }], pid);
			return read(pid);
		});

		await notesStore.init();

		expect(Object.keys(readPendingNotes(TEST_WORKSPACE))).toEqual(['elsewhere']);
	});

	it('keeps a newer journaled edit when an older write lands', async () => {
		notesStore.notes = [note('n1')];
		let land: () => void = () => undefined;
		vi.spyOn(idb, 'putNote').mockImplementationOnce(
			() => new Promise<void>((resolve) => (land = resolve))
		);
		notesStore.updateNote('n1', { title: 'first' });
		// The second write is still in flight when the first lands.
		vi.spyOn(idb, 'putNote').mockImplementationOnce(() => new Promise(() => undefined));
		notesStore.updateNote('n1', { title: 'second' });

		land();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(Object.values(readPendingNotes(TEST_WORKSPACE)).map(({ title }) => title)).toEqual([
			'second'
		]);
	});
});
