import { describe, expect, it } from 'vitest';
import { normalizeBoard } from '$lib/kanban';
import { syncStore } from '$lib/stores/sync.svelte';
import { loadBoardsFromDevice } from '$lib/syncTombstones';
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
});
