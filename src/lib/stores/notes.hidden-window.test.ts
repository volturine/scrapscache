import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { putNote, setSyncState } from '#lib/db/idb.js';
import { createKanbanBoard, type KanbanBoard } from '#lib/kanban.js';
import { BOARDS_IDB } from '#lib/syncTombstones.js';
import { readNotesMirror } from '#lib/noteStorage.js';
import type { Note } from '#lib/types.js';
import { notesStore } from './notes.svelte';
import { kanbanStore } from './kanban.svelte';
import { relaySync, syncStore } from './sync.svelte';
import { syncScheduler } from './syncScheduler';
import { linkTestWorkspace, unlinkTestWorkspace } from '../../tests/syncing';
import { TEST_WORKSPACE } from '../../tests/workspace';

type Internals = {
	show(pid: unknown): Promise<void>;
	showRewritten(pid: string): Promise<void>;
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
		notesStore.loaded = true;
		// What another window saved after its sync.
		await putNote(TEST_WORKSPACE, note('n1', 'saved elsewhere', 2));
		// Its boards are on the device, as any workspace's are once it has been open.
		await setSyncState(
			TEST_WORKSPACE,
			BOARDS_IDB,
			JSON.parse(JSON.stringify(kanbanStore.boardsForSync()))
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		internals.staleWhileHidden = null;
	});

	it('reads nothing while hidden, and catches up once shown', async () => {
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		void internals.show(TEST_WORKSPACE);
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
		void internals.show(TEST_WORKSPACE);
		await vi.waitFor(() =>
			expect(notesStore.notes.map((item) => item.title)).toEqual(['saved elsewhere'])
		);
	});

	// Boards are saved whole from memory. A window that kept showing the boards from
	// before would write them back over what the other window's sync saved.
	it('re-reads the boards the other window saved', async () => {
		const existing = JSON.parse(JSON.stringify(kanbanStore.boardsForSync())) as KanbanBoard[];
		await setSyncState(TEST_WORKSPACE, BOARDS_IDB, [
			...existing,
			{ ...createKanbanBoard('Saved elsewhere'), id: 'board-from-elsewhere' }
		]);
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
		void internals.show(TEST_WORKSPACE);
		await vi.waitFor(() =>
			expect(kanbanStore.boards.map((board) => board.name)).toContain('Saved elsewhere')
		);
		expect(kanbanStore.boards).toHaveLength(existing.length + 1);
	});

	// A rewrite takes things away without recording a delete for each: a backup that
	// replaces the workspace leaves only its own labels. Merged into what this window
	// holds, the old ones would stay, and be saved back at the next start.
	it('loads the workspace again when another window rewrote it, instead of merging', async () => {
		notesStore.labels = [
			{ id: 'replaced', name: 'Gone with the rewrite', createdAt: 1, updatedAt: 1 }
		];
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		const reload = vi.spyOn(notesStore, 'reloadForProfile');

		await internals.showRewritten(TEST_WORKSPACE);
		expect(reload).not.toHaveBeenCalled();
		// Hidden, it mirrors nothing of what it still holds.
		internals.mirrorToLS();
		expect(readNotesMirror(TEST_WORKSPACE)).toEqual([]);

		setVisibility('visible');
		await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
		await vi.waitFor(() =>
			expect(notesStore.notes.map((item) => item.title)).toEqual(['saved elsewhere'])
		);
		expect(notesStore.labels).toEqual([]);
	});

	it('ignores another workspace', async () => {
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		void internals.show('some-other-workspace');
		expect(internals.staleWhileHidden).toBeNull();
	});

	it('does not write its outdated notes to the mirror', () => {
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		void internals.show(TEST_WORKSPACE);
		internals.mirrorToLS();
		expect(readNotesMirror(TEST_WORKSPACE)).toEqual([]);
	});

	it('catches up when a sync of its own lands, and shows what the other window saved', async () => {
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		void internals.show(TEST_WORKSPACE);
		linkTestWorkspace();
		// The sync sends what the database holds, which the other window's save is part of.
		const sent: string[][] = [];
		vi.spyOn(relaySync, 'sync').mockImplementation(async (_profile, local, saved) => {
			sent.push(local.notes.map((item) => item.title));
			await saved(local, TEST_WORKSPACE, {
				relayHolds: () => true,
				relayHas: () => undefined,
				owes: async () => undefined
			});
			return { success: true, snapshot: local };
		});

		try {
			await syncScheduler.request(syncStore.activeId);
		} finally {
			await syncScheduler.reset();
			unlinkTestWorkspace();
		}

		expect(sent).toEqual([['saved elsewhere']]);
		expect(notesStore.notes.map((item) => item.title)).toEqual(['saved elsewhere']);
		expect(internals.staleWhileHidden).toBeNull();
	});
});
