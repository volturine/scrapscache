import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createKanbanBoard, type KanbanBoard } from '$lib/kanban';
import { getSyncOutboxKeys, LOCAL_PROFILE_ID } from '$lib/db/idb';
import { createSyncIdentity } from '$lib/syncPairing';
import { loadBoardsFromDevice, saveBoardsToDevice } from '$lib/syncTombstones';
import { KanbanStore } from './kanban.svelte';
import { syncStore } from './sync.svelte';

describe('kanban persist during sync', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('does not persist boards to IndexedDB until a durable mutation', async () => {
		const store = new KanbanStore();
		store.selectBoard(store.boards[0].id);
		await tick();
		expect(await loadBoardsFromDevice(LOCAL_PROFILE_ID, null)).toBeNull();
		expect(await getSyncOutboxKeys()).toEqual([]);
	});

	it('writes $state boards to IndexedDB without throwing DataCloneError', async () => {
		const store = new KanbanStore();
		await expect(store.persistSyncState()).resolves.toBeUndefined();
		const stored = await loadBoardsFromDevice<unknown>(LOCAL_PROFILE_ID, null);
		expect(stored).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: store.boards[0].id,
					name: store.boards[0].name
				})
			])
		);
		expect(() => structuredClone(stored)).not.toThrow();
	});

	it('gives later same-millisecond board edits a newer version', async () => {
		localStorage.clear();
		vi.spyOn(Date, 'now').mockReturnValue(1_000);
		const store = new KanbanStore();
		const boardId = store.boards[0].id;
		store.renameBoard(boardId, 'First');
		store.renameBoard(boardId, 'Second');
		expect(store.boards[0]?.name).toBe('Second');
		expect(store.boards[0]?.updatedAt).toBe(1_002);
		await (store as unknown as { pendingDeviceWrites: Promise<void> }).pendingDeviceWrites;
		vi.restoreAllMocks();
	});

	it('keeps a newer localStorage board over a stale IndexedDB copy', async () => {
		const store = new KanbanStore();
		const base = store.boardsForSync()[0];
		store.boards = [{ ...base, name: 'stale', updatedAt: 1 }];
		await store.persistSyncState();
		store.boards = [{ ...base, name: 'from-ls', updatedAt: 2 }];
		await store.hydrateFromDevice();
		expect(store.boards[0]?.name).toBe('from-ls');
		expect((await loadBoardsFromDevice(LOCAL_PROFILE_ID, store.boardsForSync()))[0]?.name).toBe(
			'from-ls'
		);
	});

	it('keeps a queued board write owned by the profile where the edit happened', async () => {
		const accountA = createSyncIdentity();
		const accountB = createSyncIdentity();
		const profileA = { id: 'board-a', name: 'A', syncKey: accountA.syncKey, createdAt: 1 };
		const profileB = { id: 'board-b', name: 'B', syncKey: accountB.syncKey, createdAt: 2 };
		syncStore.profiles = [profileA, profileB];
		syncStore.activateProfile(profileA);
		const store = new KanbanStore();
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		(store as unknown as { pendingDeviceWrites: Promise<void> }).pendingDeviceWrites = blocked;

		store.renameBoard(store.boards[0].id, 'Saved in A');
		syncStore.activateProfile(profileB);
		release();
		await store.waitForPendingWrites();

		expect((await loadBoardsFromDevice<typeof store.boards>('board-a', [])).at(0)?.name).toBe(
			'Saved in A'
		);
		expect(await loadBoardsFromDevice('board-b', null)).toBeNull();
		expect(await getSyncOutboxKeys('board-a')).toEqual([`board:${store.boards[0].id}`]);
		expect(await getSyncOutboxKeys('board-b')).toEqual([]);
		syncStore.account = null;
		syncStore.profiles = [];
	});
});

describe('replaceWithCloud', () => {
	it('keeps the active board when it still exists in the cloud state', () => {
		const store = new KanbanStore();
		const kept = createKanbanBoard('Kept');
		const other = createKanbanBoard('Other');
		store.replaceWithCloud([other, kept]);
		store.selectBoard(kept.id);
		store.replaceWithCloud([kept, { ...other, name: 'Renamed' }]);
		expect(store.activeBoardId).toBe(kept.id);
		expect(store.boards.map((board) => board.name)).toEqual(['Kept', 'Renamed']);
	});

	it('falls back to the first board when the active board is gone', () => {
		const store = new KanbanStore();
		const kept = createKanbanBoard('Kept');
		store.replaceWithCloud([kept]);
		store.selectBoard(kept.id);
		store.replaceWithCloud([createKanbanBoard('Fresh')]);
		expect(store.activeBoardId).toBe(store.boards[0].id);
	});
});

describe('boards belong to the workspace that saved them', () => {
	it('reads back what a signed-in workspace saved, not the anonymous one', async () => {
		// The anonymous workspace has boards of its own on this device.
		await saveBoardsToDevice(LOCAL_PROFILE_ID, [
			{ ...createKanbanBoard('Anonymous board'), id: 'anon-board' }
		]);
		const arranged = {
			...createKanbanBoard('Work'),
			id: 'work-board',
			columns: [{ id: 'todo', labelId: null, order: ['n2', 'n1'] }]
		};
		await saveBoardsToDevice('workspace-1', [arranged]);

		const mine = await loadBoardsFromDevice<KanbanBoard[] | undefined>('workspace-1', undefined);

		expect(mine?.map((board) => board.id)).toEqual(['work-board']);
		expect(mine?.[0].columns[0].order).toEqual(['n2', 'n1']);
	});

	it('reports nothing rather than another workspace\u2019s boards when it has none', async () => {
		await saveBoardsToDevice(LOCAL_PROFILE_ID, [createKanbanBoard('Anonymous board')]);

		expect(await loadBoardsFromDevice('workspace-2', undefined)).toBeUndefined();
	});
});
