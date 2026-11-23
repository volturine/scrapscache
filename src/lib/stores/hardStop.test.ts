/**
 * A change outlives the app being stopped before its save to the database landed,
 * whatever kind of record it is. Each test stops the app at that moment: the save
 * never finishes, the copies kept only for a quicker start are gone, and a fresh
 * start has to bring the change back and save it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as canvasLibrary from '#lib/canvasLibrary.js';
import { readCanvasLibrary } from '#lib/canvasLibrary.js';
import * as idb from '#lib/db/idb.js';
import { clearSyncOutbox, getSyncOutboxKeys, setSyncState } from '#lib/db/idb.js';
import { normalizeBoard, type KanbanBoard } from '#lib/kanban.js';
import { LABELS_MIRROR_KEY, pendingLabels, pendingNoteDeletes } from '#lib/noteStorage.js';
import * as syncTombstones from '#lib/syncTombstones.js';
import { BOARDS_IDB, loadBoardsFromDevice, readStoredTombstones } from '#lib/syncTombstones.js';
import { CanvasLibraryStore } from './canvasLibrary';
import { KanbanStore } from './kanban.svelte';
import { notesStore } from './notes.svelte';
import { syncStore } from './sync.svelte';
import { emptyWorkspace, TEST_WORKSPACE } from '../../tests/workspace';

/** A save the app is stopped before the end of. */
const neverLands = () => new Promise<never>(() => undefined);

/** Only what was written for a restart is left: the copies for a quicker start are not. */
function dropFastStartCopies(): void {
	for (const key of Object.keys(localStorage)) {
		if (key.startsWith('scrapscache-kanban-') || key.startsWith(LABELS_MIRROR_KEY))
			localStorage.removeItem(key);
	}
}

beforeEach(async () => {
	localStorage.clear();
	await emptyWorkspace(TEST_WORKSPACE);
	notesStore.notes = [];
	notesStore.labels = [];
	notesStore.deletedNoteIds = {};
	notesStore.deletedLabelIds = {};
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('a label', () => {
	it('comes back and is saved when the app stopped before its save landed', async () => {
		vi.spyOn(idb, 'saveLabel').mockImplementationOnce(neverLands);
		const label = notesStore.createLabel('Kept through a stop')!;
		dropFastStartCopies();
		vi.mocked(idb.saveLabel).mockRestore();

		await notesStore.reloadForProfile();

		expect(notesStore.labels.map(({ name }) => name)).toEqual(['Kept through a stop']);
		await vi.waitFor(async () =>
			expect((await idb.getAllLabels(TEST_WORKSPACE)).map(({ id }) => id)).toEqual([label.id])
		);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toContain(`label:${label.id}`);
		await vi.waitFor(() => expect(pendingLabels.read(TEST_WORKSPACE)).toEqual({}));
	});

	it('stays deleted when the app stopped before its delete landed', async () => {
		const label = notesStore.createLabel('Deleted before a stop')!;
		await vi.waitFor(async () =>
			expect((await idb.getAllLabels(TEST_WORKSPACE)).map(({ id }) => id)).toEqual([label.id])
		);
		vi.spyOn(syncTombstones, 'deleteLabelWithTombstone').mockImplementationOnce(neverLands);
		notesStore.removeLabel(label.id);
		dropFastStartCopies();
		vi.mocked(syncTombstones.deleteLabelWithTombstone).mockRestore();

		await notesStore.reloadForProfile();

		expect(notesStore.labels).toEqual([]);
		await vi.waitFor(async () => expect(await idb.getAllLabels(TEST_WORKSPACE)).toEqual([]));
		expect((await readStoredTombstones(TEST_WORKSPACE)).labels).toHaveProperty(label.id);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toContain(`label-tombstone:${label.id}`);
		await vi.waitFor(() => expect(pendingLabels.read(TEST_WORKSPACE)).toEqual({}));
	});
});

describe('a note deleted for good', () => {
	const trashed = async (title: string) => {
		const note = notesStore.createNote({ title });
		notesStore.trashNote(note.id);
		await idb.waitForDeviceWrites(TEST_WORKSPACE);
		return note;
	};

	it('stays deleted when the app stopped before its delete landed', async () => {
		const note = await trashed('Gone for good');
		vi.spyOn(syncTombstones, 'addTombstones').mockImplementation(neverLands);
		void notesStore.deleteNoteForever(note.id);
		await vi.waitFor(() => expect(syncTombstones.addTombstones).toHaveBeenCalled());
		vi.mocked(syncTombstones.addTombstones).mockRestore();

		await notesStore.reloadForProfile();

		expect(notesStore.notes.map(({ id }) => id)).not.toContain(note.id);
		await vi.waitFor(async () =>
			expect((await readStoredTombstones(TEST_WORKSPACE)).notes).toHaveProperty(note.id)
		);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toContain(`note-tombstone:${note.id}`);
		await vi.waitFor(async () =>
			expect((await idb.getAllNotesMetadata(TEST_WORKSPACE)).map(({ id }) => id)).not.toContain(
				note.id
			)
		);
		await vi.waitFor(() => expect(pendingNoteDeletes.read(TEST_WORKSPACE)).toEqual({}));
	});

	it('is kept when it was taken out of the trash before the next start', async () => {
		const note = await trashed('Restored after all');
		// A delete that a stop left in the journal.
		pendingNoteDeletes.add(TEST_WORKSPACE, { [note.id]: Date.now() });
		await new Promise((resolve) => setTimeout(resolve, 2));
		notesStore.restoreNote(note.id);
		await idb.waitForDeviceWrites(TEST_WORKSPACE);

		await notesStore.reloadForProfile();

		expect(notesStore.notes.map(({ id }) => id)).toContain(note.id);
		expect((await readStoredTombstones(TEST_WORKSPACE)).notes).not.toHaveProperty(note.id);
		await vi.waitFor(() => expect(pendingNoteDeletes.read(TEST_WORKSPACE)).toEqual({}));
	});

	it('takes its entry out of the journal when the delete could not be saved', async () => {
		const note = await trashed('Still here after a failed delete');
		vi.spyOn(syncTombstones, 'addTombstones').mockRejectedValueOnce(new Error('Storage full'));

		await expect(notesStore.deleteNoteForever(note.id)).rejects.toThrow('Storage full');

		// The note is still shown, so nothing may delete it behind the person's back later.
		expect(notesStore.notes.map(({ id }) => id)).toContain(note.id);
		expect(pendingNoteDeletes.read(TEST_WORKSPACE)).toEqual({});
	});
});

describe('a label change left in the journal', () => {
	it('does not go over a later rename the database already holds', async () => {
		const label = { id: 'renamed-elsewhere', name: 'Before', createdAt: 1, updatedAt: 10 };
		await idb.saveLabel(TEST_WORKSPACE, { ...label, name: 'Later, by a sync', updatedAt: 50 });
		pendingLabels.add(TEST_WORKSPACE, { [label.id]: label });

		await notesStore.reloadForProfile();

		expect(notesStore.labels.map(({ name }) => name)).toEqual(['Later, by a sync']);
		await vi.waitFor(() => expect(pendingLabels.read(TEST_WORKSPACE)).toEqual({}));
		expect((await idb.getAllLabels(TEST_WORKSPACE)).map(({ name }) => name)).toEqual([
			'Later, by a sync'
		]);
	});

	it('does not write a label back that was deleted since the change was journaled', async () => {
		const label = {
			id: 'deleted-since',
			name: 'Renamed before a stop',
			createdAt: 1,
			updatedAt: 10
		};
		await syncTombstones.deleteLabelWithTombstone(TEST_WORKSPACE, label.id, 50);
		pendingLabels.add(TEST_WORKSPACE, { [label.id]: label });

		await notesStore.reloadForProfile();
		await notesStore.waitForPendingProfileWrites();

		expect(notesStore.labels).toEqual([]);
		expect(await idb.getAllLabels(TEST_WORKSPACE)).toEqual([]);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).not.toContain(`label:${label.id}`);
		expect(pendingLabels.read(TEST_WORKSPACE)).toEqual({});
	});

	it('leaves a newer change another window journaled while it is saved again', async () => {
		const older = { id: 'two-windows', name: 'Older', createdAt: 1, updatedAt: 10 };
		const newer = { ...older, name: 'Newer, from the other window', updatedAt: 20 };
		pendingLabels.add(TEST_WORKSPACE, { [older.id]: older });
		const save = idb.saveLabel;
		vi.spyOn(idb, 'saveLabel').mockImplementationOnce(async (...args) => {
			// The other window changes the label again while this start is saving.
			pendingLabels.add(TEST_WORKSPACE, { [older.id]: newer });
			return save(...args);
		});

		await notesStore.reloadForProfile();
		await vi.waitFor(async () =>
			expect((await idb.getAllLabels(TEST_WORKSPACE)).map(({ id }) => id)).toEqual([older.id])
		);
		await notesStore.waitForPendingProfileWrites();

		// Its save has not landed yet, so its entry is still there for a start to replay.
		expect(pendingLabels.read(TEST_WORKSPACE)).toEqual({ [older.id]: newer });
	});
});

describe('a board', () => {
	const pid = () => syncStore.activePid;
	const storedBoards = async () =>
		(await loadBoardsFromDevice<Array<{ id: string }>>(pid(), [])).map(({ id }) => id);

	it('comes back and is saved when the app stopped before its save landed', async () => {
		const store = new KanbanStore();
		await store.hydrateFromDevice(pid());
		vi.spyOn(syncTombstones, 'writeKanbanState').mockImplementation(neverLands);
		const board = store.createBoard('Kept through a stop');
		// The save has started, and the app is stopped before it ends.
		await vi.waitFor(() => expect(syncTombstones.writeKanbanState).toHaveBeenCalled());
		dropFastStartCopies();
		vi.mocked(syncTombstones.writeKanbanState).mockRestore();

		const restarted = new KanbanStore();
		await restarted.hydrateFromDevice(pid());

		expect(restarted.boards.map(({ name }) => name)).toContain('Kept through a stop');
		await restarted.waitForPendingWrites();
		expect(await storedBoards()).toContain(board.id);
		expect(await getSyncOutboxKeys(pid())).toContain(`board:${board.id}`);
		await vi.waitFor(() =>
			expect(localStorage.getItem(`scrapscache-boards-pending:${pid()}`)).toBeNull()
		);
	});

	it('stays deleted when the app stopped before its delete landed', async () => {
		const store = new KanbanStore();
		await store.hydrateFromDevice(pid());
		const board = store.createBoard('Deleted before a stop');
		await store.waitForPendingWrites();
		expect(await storedBoards()).toContain(board.id);
		vi.spyOn(syncTombstones, 'writeKanbanState').mockImplementation(neverLands);
		store.deleteBoard(board.id);
		// The save has started, and the app is stopped before it ends.
		await vi.waitFor(() => expect(syncTombstones.writeKanbanState).toHaveBeenCalled());
		dropFastStartCopies();
		vi.mocked(syncTombstones.writeKanbanState).mockRestore();

		const restarted = new KanbanStore();
		await restarted.hydrateFromDevice(pid(), (await readStoredTombstones(pid())).boards);

		expect(restarted.boards.map(({ id }) => id)).not.toContain(board.id);
		await restarted.waitForPendingWrites();
		expect(await storedBoards()).not.toContain(board.id);
		expect((await readStoredTombstones(pid())).boards).toHaveProperty(board.id);
		expect(await getSyncOutboxKeys(pid())).toContain(`board-tombstone:${board.id}`);
	});

	it('stays deleted when the copies for a quicker start are still there, as after a real stop', async () => {
		const store = new KanbanStore();
		await store.hydrateFromDevice(pid());
		const board = store.createBoard('Deleted, mirror kept');
		await store.waitForPendingWrites();
		vi.spyOn(syncTombstones, 'writeKanbanState').mockImplementation(neverLands);
		store.deleteBoard(board.id);
		await vi.waitFor(() => expect(syncTombstones.writeKanbanState).toHaveBeenCalled());
		vi.mocked(syncTombstones.writeKanbanState).mockRestore();

		const restarted = new KanbanStore();
		await restarted.hydrateFromDevice(pid(), (await readStoredTombstones(pid())).boards);
		await restarted.waitForPendingWrites();

		// The database has the delete and owes it to the relay, not only the mirror.
		expect(await storedBoards()).not.toContain(board.id);
		expect((await readStoredTombstones(pid())).boards).toHaveProperty(board.id);
		expect(await getSyncOutboxKeys(pid())).toContain(`board-tombstone:${board.id}`);
	});

	it('keeps a rename left in the journal when a sync saved a later change to another part', async () => {
		const store = new KanbanStore();
		await store.hydrateFromDevice(pid());
		const board = store.createBoard('Before');
		await store.waitForPendingWrites();

		// The window renames the board and is stopped before the save lands.
		vi.spyOn(syncTombstones, 'writeKanbanState').mockImplementation(neverLands);
		store.renameBoard(board.id, 'Renamed before a stop');
		await vi.waitFor(() => expect(syncTombstones.writeKanbanState).toHaveBeenCalled());
		vi.mocked(syncTombstones.writeKanbanState).mockRestore();
		// Afterwards a sync saves what another device changed in a different part of it.
		const later = Date.now() + 60_000;
		const stored = await loadBoardsFromDevice<KanbanBoard[]>(pid(), []);
		await setSyncState(
			pid(),
			BOARDS_IDB,
			stored.map((candidate) =>
				candidate.id === board.id
					? {
							...candidate,
							noteFilter: { action: 'remove', labelIds: ['later-label'] },
							// As a merged board has them: a time for every part, so only the
							// filter is later than what this device wrote.
							fieldTimes: {
								name: candidate.updatedAt,
								backlogFilter: candidate.updatedAt,
								columns: candidate.updatedAt,
								...candidate.fieldTimes,
								noteFilter: later
							},
							updatedAt: later
						}
					: candidate
			)
		);
		await clearSyncOutbox(pid(), await getSyncOutboxKeys(pid()));
		dropFastStartCopies();

		const restarted = new KanbanStore();
		await restarted.hydrateFromDevice(pid());
		await restarted.waitForPendingWrites();

		const saved = (await loadBoardsFromDevice<unknown[]>(pid(), []))
			.map(normalizeBoard)
			.find((candidate) => candidate?.id === board.id);
		expect(saved?.name).toBe('Renamed before a stop');
		expect(saved?.noteFilter).toEqual({ action: 'remove', labelIds: ['later-label'] });
		expect(await getSyncOutboxKeys(pid())).toContain(`board:${board.id}`);
		await vi.waitFor(() =>
			expect(localStorage.getItem(`scrapscache-boards-pending:${pid()}`)).toBeNull()
		);
	});

	it("never saves a failed save's retry into a workspace whose boards the store does not hold", async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const here = pid();
		const other = 'hard-stop-other-workspace';
		const names = async (workspace: string) =>
			(await loadBoardsFromDevice<Array<{ name: string }>>(workspace, [])).map(({ name }) => name);
		const store = new KanbanStore();
		await store.hydrateFromDevice(here);
		vi.spyOn(syncTombstones, 'writeKanbanState').mockRejectedValueOnce(new Error('Storage full'));
		store.createBoard('Owed here');
		await store.waitForPendingWrites();
		try {
			// The window moves to another workspace and its boards are loaded...
			syncStore.activeId = other;
			await store.hydrateFromDevice(other);
			store.createBoard('Only in the other workspace');
			await store.waitForPendingWrites();
			// ...and starts back: until that load ends the store holds the other one's boards.
			syncStore.activeId = here;
			await vi.advanceTimersByTimeAsync(2_000);
			await store.waitForPendingWrites();

			expect(await names(here)).not.toContain('Only in the other workspace');

			// The load replays what the failed save left in the journal.
			await store.hydrateFromDevice(here);
			await store.waitForPendingWrites();
			expect(await names(here)).toContain('Owed here');
			expect(await names(here)).not.toContain('Only in the other workspace');
		} finally {
			syncStore.activeId = here;
		}
	});

	it('is saved on a later try when its save failed, with its upload mark', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const store = new KanbanStore();
		await store.hydrateFromDevice(pid());
		vi.spyOn(syncTombstones, 'writeKanbanState').mockRejectedValueOnce(new Error('Storage full'));
		const board = store.createBoard('Saved on a second try');
		await store.waitForPendingWrites();
		expect(await storedBoards()).not.toContain(board.id);

		await vi.advanceTimersByTimeAsync(1_500);

		await vi.waitFor(async () => expect(await storedBoards()).toContain(board.id));
		expect(await getSyncOutboxKeys(pid())).toContain(`board:${board.id}`);
	});
});

describe('a canvas library item', () => {
	const item = (id: string) => ({
		id,
		status: 'unpublished',
		created: 1,
		elements: [{ id: `${id}-shape` }]
	});

	it('comes back and is saved when the app stopped before its save landed', async () => {
		const store = new CanvasLibraryStore();
		await store.hydrate('library-stopped');
		vi.spyOn(canvasLibrary, 'mergeStoredCanvasLibrary').mockImplementation(neverLands);
		store.applyEditorChange([], [item('star')]);
		// The save has started, and the app is stopped before it ends.
		await vi.waitFor(() => expect(canvasLibrary.mergeStoredCanvasLibrary).toHaveBeenCalled());
		vi.mocked(canvasLibrary.mergeStoredCanvasLibrary).mockRestore();

		const restarted = new CanvasLibraryStore();
		await restarted.hydrate('library-stopped');

		expect(restarted.items().map(({ id }) => id)).toEqual(['star']);
		await restarted.waitForPendingWrites();
		expect((await readCanvasLibrary('library-stopped')).entries.map(({ id }) => id)).toEqual([
			'star'
		]);
		expect(await getSyncOutboxKeys('library-stopped')).toContain('library-item:star');
		expect(localStorage.getItem('scrapscache-library-pending:library-stopped')).toBeNull();
	});

	it('stays removed when the app stopped before its removal landed', async () => {
		const store = new CanvasLibraryStore();
		await store.hydrate('library-removed');
		store.applyEditorChange([], [item('star')]);
		await store.waitForPendingWrites();
		vi.spyOn(canvasLibrary, 'mergeStoredCanvasLibrary').mockImplementation(neverLands);
		store.applyEditorChange([item('star')], []);
		// The save has started, and the app is stopped before it ends.
		await vi.waitFor(() => expect(canvasLibrary.mergeStoredCanvasLibrary).toHaveBeenCalled());
		vi.mocked(canvasLibrary.mergeStoredCanvasLibrary).mockRestore();

		const restarted = new CanvasLibraryStore();
		await restarted.hydrate('library-removed');

		expect(restarted.items()).toEqual([]);
		await restarted.waitForPendingWrites();
		const stored = await readCanvasLibrary('library-removed');
		expect(stored.entries).toEqual([]);
		expect(stored.tombstones).toHaveProperty('star');
		expect(await getSyncOutboxKeys('library-removed')).toContain('library-item-tombstone:star');
	});

	it('is saved on a later try when its save failed', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const store = new CanvasLibraryStore();
		await store.hydrate('library-retried');
		vi.spyOn(canvasLibrary, 'mergeStoredCanvasLibrary').mockRejectedValueOnce(
			new Error('Storage full')
		);
		store.applyEditorChange([], [item('star')]);
		await store.waitForPendingWrites();
		expect((await readCanvasLibrary('library-retried')).entries).toEqual([]);

		await vi.advanceTimersByTimeAsync(1_500);

		await vi.waitFor(async () =>
			expect((await readCanvasLibrary('library-retried')).entries.map(({ id }) => id)).toEqual([
				'star'
			])
		);
		expect(await getSyncOutboxKeys('library-retried')).toContain('library-item:star');
	});
});
