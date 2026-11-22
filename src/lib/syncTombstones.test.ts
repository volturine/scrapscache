import { describe, expect, it } from 'vitest';
import { getSyncOutboxKeys, setSyncState } from '#lib/db/idb.js';
import {
	addTombstones,
	BOARD_IDB,
	hydrateTombstones,
	loadBoardsFromDevice,
	NOTE_IDB,
	readStoredTombstones,
	readTombstones,
	saveBoardsToDevice,
	writeKanbanState
} from './syncTombstones';
import { TEST_WORKSPACE } from '../tests/workspace';

describe('kanban board persistence', () => {
	it('stores a structured-cloneable snapshot so reactive proxies cannot fail IndexedDB', async () => {
		const boards = [
			{
				id: 'board-1',
				name: 'Work',
				columns: [{ id: 'backlog', labelId: null }],
				backlogFilter: { mode: 'all-non-column', includeUntagged: true, labelIds: [] },
				updatedAt: 1
			}
		];
		const proxied = new Proxy(boards, {});
		await expect(saveBoardsToDevice(TEST_WORKSPACE, proxied)).resolves.toBeUndefined();
		const stored = await loadBoardsFromDevice(TEST_WORKSPACE, null);
		expect(stored).toEqual(boards);
		expect(structuredClone(stored)).toEqual(boards);
	});
});

// A sync saves deletes and boards into a workspace's database while a window has
// it open. What that window saves next goes on top of them, never over them.
describe('saves made while a sync has saved meanwhile', () => {
	it('keeps a delete a sync saved when this window records another', async () => {
		await hydrateTombstones(TEST_WORKSPACE);
		// Saved by a sync after this window loaded.
		await setSyncState(TEST_WORKSPACE, NOTE_IDB, { 'deleted-elsewhere': 40 });

		const all = await addTombstones(TEST_WORKSPACE, { 'deleted-here': 50 }, [
			'note-tombstone:deleted-here'
		]);

		expect(all).toEqual({ 'deleted-elsewhere': 40, 'deleted-here': 50 });
		expect((await readStoredTombstones(TEST_WORKSPACE)).notes).toEqual(all);
		expect(readTombstones()).toEqual(all);
		// The delete and its upload marker are one write.
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toContain('note-tombstone:deleted-here');
	});

	it('merges boards with the stored ones, and replaces them only when asked to', async () => {
		type Board = { id: string; name: string };
		const merge = (stored: unknown, mine: Board[], deleted: Record<string, number>) =>
			[...(stored as Board[]).filter((board) => !mine.some(({ id }) => id === board.id)), ...mine]
				.filter((board) => !deleted[board.id])
				.sort((a, b) => a.id.localeCompare(b.id));
		await saveBoardsToDevice(TEST_WORKSPACE, [
			{ id: 'pulled', name: 'Saved by a sync' },
			{ id: 'removed-elsewhere', name: 'Still stored' }
		]);
		await setSyncState(TEST_WORKSPACE, BOARD_IDB, { 'removed-elsewhere': 7 });

		await writeKanbanState(
			TEST_WORKSPACE,
			[{ id: 'mine', name: 'Edited here' }],
			{},
			['board:mine'],
			merge
		);

		expect(await loadBoardsFromDevice(TEST_WORKSPACE, null)).toEqual([
			{ id: 'mine', name: 'Edited here' },
			{ id: 'pulled', name: 'Saved by a sync' }
		]);
		expect((await readStoredTombstones(TEST_WORKSPACE)).boards).toEqual({ 'removed-elsewhere': 7 });
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toContain('board:mine');

		// Taking the cloud's boards in place of this device's is the one replacement.
		await writeKanbanState(TEST_WORKSPACE, [{ id: 'cloud', name: 'From the cloud' }], {});
		expect(await loadBoardsFromDevice(TEST_WORKSPACE, null)).toEqual([
			{ id: 'cloud', name: 'From the cloud' }
		]);
	});
});
