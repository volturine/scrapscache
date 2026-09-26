import { describe, expect, it } from 'vitest';
import { loadBoardsFromDevice, saveBoardsToDevice } from './syncTombstones';
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
