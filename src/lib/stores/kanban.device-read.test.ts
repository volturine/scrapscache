import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKanbanBoard } from '#lib/kanban.js';
import { workspaceKey } from '#lib/db/idb.js';
import * as syncTombstones from '#lib/syncTombstones.js';
import { KanbanStore } from './kanban.svelte';

const BOARDS_KEY = 'scrapscache-kanban-boards-v1';

describe('kanban store without a readable device store', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		localStorage.clear();
	});

	it('hydrates from the mirror and reports the device read failure afterwards', async () => {
		const pid = 'mirror-only';
		const mirrored = { ...createKanbanBoard('From the mirror'), updatedAt: 5 };
		localStorage.setItem(workspaceKey(BOARDS_KEY, pid), JSON.stringify([mirrored]));
		vi.spyOn(syncTombstones, 'loadBoardsFromDevice').mockRejectedValueOnce(
			new Error('IndexedDB is not available')
		);
		const write = vi.spyOn(syncTombstones, 'writeKanbanState');
		const store = new KanbanStore();

		await expect(store.hydrateFromDevice(pid)).rejects.toThrow('IndexedDB is not available');

		expect(store.boards.map((board) => board.id)).toEqual([mirrored.id]);
		expect(store.activeBoardId).toBe(mirrored.id);
		// Nothing is known to be missing from a store that could not be read.
		expect(write).not.toHaveBeenCalled();
	});

	it('keeps a sync or import going when localStorage is full', () => {
		const store = new KanbanStore();
		const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const remote = { ...createKanbanBoard('Synced board'), updatedAt: 9 };

		expect(() => store.applySync([remote])).not.toThrow();

		expect(store.boards.some((board) => board.id === remote.id)).toBe(true);
		expect(setItem).toHaveBeenCalled();
		expect(warn).toHaveBeenCalled();
	});

	it('does not hide a localStorage failure that is not about space', () => {
		const store = new KanbanStore();
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('Access is denied for this document.', 'SecurityError');
		});

		expect(() => store.applySync([createKanbanBoard('Synced board')])).toThrow('Access is denied');
	});
});
