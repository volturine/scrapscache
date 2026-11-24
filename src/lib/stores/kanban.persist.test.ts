import { describe, expect, it } from 'vitest';
import { createKanbanBoard, normalizeBoard } from '#lib/kanban.js';
import { setSyncState } from '#lib/db/idb.js';
import { syncStore } from '#lib/stores/sync.svelte.js';
import { BOARDS_IDB, loadBoardsFromDevice } from '#lib/syncTombstones.js';
import { KanbanStore } from './kanban.svelte';

describe('board note filter persistence', () => {
	it('survives a reload, from the fast-boot mirror and from IndexedDB alike', async () => {
		const store = new KanbanStore();
		const boardId = store.activeBoard.id;
		store.setNoteFilter(boardId, { action: 'remove', labelIds: ['work-label'] });
		await store.waitForPendingWrites();

		const reloaded = new KanbanStore();
		expect(reloaded.activeBoard.noteFilter).toEqual({ action: 'remove', labelIds: ['work-label'] });

		const stored = await loadBoardsFromDevice<unknown[]>(syncStore.activePid, []);
		const fromDevice = stored.map(normalizeBoard).find((board) => board?.id === boardId);
		expect(fromDevice?.noteFilter).toEqual({ action: 'remove', labelIds: ['work-label'] });
	});
	// A sync saves the boards it pulled into the database. A board edit made before
	// the window shows them is saved on top of them, not over them.
	it('keeps a board a sync saved meanwhile when another board is edited', async () => {
		const store = new KanbanStore();
		const mine = store.activeBoard.id;
		store.setNoteFilter(mine, { action: 'remove', labelIds: ['first'] });
		await store.waitForPendingWrites();
		const stored = await loadBoardsFromDevice<Array<{ id: string }>>(syncStore.activePid, []);
		await setSyncState(syncStore.activePid, BOARDS_IDB, [
			...stored,
			{ ...createKanbanBoard('Pulled by a sync'), id: 'pulled-meanwhile' }
		]);

		store.setNoteFilter(mine, { action: 'remove', labelIds: ['second'] });
		await store.waitForPendingWrites();

		const after = (await loadBoardsFromDevice<unknown[]>(syncStore.activePid, [])).map(
			normalizeBoard
		);
		expect(after.map((board) => board?.id).sort()).toEqual([mine, 'pulled-meanwhile'].sort());
		expect(after.find((board) => board?.id === mine)?.noteFilter).toEqual({
			action: 'remove',
			labelIds: ['second']
		});
	});
});
