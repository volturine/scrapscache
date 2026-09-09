import { describe, expect, it, vi } from 'vitest';
import {
	getAllNotesMetadata,
	getAllLabels,
	putNote,
	bulkPutLabels,
	setSyncState,
	getSyncState,
	scopedStateKey,
	unlinkProfileToNamespace,
	hydrateNoteAttachments
} from './idb';
import { BOARDS_IDB, NOTE_IDB } from '$lib/syncTombstones';
import { createKanbanBoard, type KanbanBoard } from '$lib/kanban';
import type { Note } from '$lib/types';

function note(title: string): Note {
	return {
		id: 'shared',
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
		labels: ['tag'],
		images: [
			{ id: 'photo', mime: 'image/png', dataUrl: 'data:image/png;base64,QQ==', createdAt: 1 }
		]
	};
}

describe('unlink appends workspace data', () => {
	it('keeps colliding notes, labels, photos and boards from both workspaces', async () => {
		const source = 'unlink-source',
			target = 'unlink-target';
		await putNote(source, note('Synced note'));
		await putNote(target, note('Anonymous note'));
		await bulkPutLabels(source, [{ id: 'tag', name: 'Synced tag', createdAt: 1, updatedAt: 1 }]);
		await bulkPutLabels(target, [{ id: 'tag', name: 'Anonymous tag', createdAt: 1, updatedAt: 1 }]);
		const board = {
			...createKanbanBoard('Synced board'),
			id: 'board',
			columns: [{ id: 'column', labelId: 'tag' }]
		};
		await setSyncState(scopedStateKey(BOARDS_IDB, source), [board]);
		await setSyncState(scopedStateKey(BOARDS_IDB, target), [{ ...board, name: 'Anonymous board' }]);
		await unlinkProfileToNamespace(source, target);
		const notes = await getAllNotesMetadata(target);
		expect(notes.map((note) => note.title).sort()).toEqual(['Anonymous note', 'Synced note']);
		const imported = notes.find((note) => note.title === 'Synced note')!;
		expect(imported.id).not.toBe('shared');
		expect(imported.images![0].id).not.toBe('photo');
		expect((await hydrateNoteAttachments(target, imported)).images![0].dataUrl).toBe(
			'data:image/png;base64,QQ=='
		);
		const labels = await getAllLabels(target);
		expect(labels).toHaveLength(2);
		expect(imported.labels).toEqual([labels.find((label) => label.name === 'Synced tag')!.id]);
		const boards = await getSyncState<KanbanBoard[]>(scopedStateKey(BOARDS_IDB, target));
		expect(boards).toHaveLength(2);
		expect(boards![1].columns[0].labelId).toBe(imported.labels[0]);
		expect(boards![1].id).not.toBe('board');
		expect((await getAllNotesMetadata(source))[0].id).toBe('shared');
	});

	it('does not let anonymous tombstones hide appended notes', async () => {
		await putNote('tombstone-source', note('Keep this'));
		await setSyncState(scopedStateKey(NOTE_IDB, 'tombstone-target'), { shared: 100 });
		await unlinkProfileToNamespace('tombstone-source', 'tombstone-target');
		expect((await getAllNotesMetadata('tombstone-target'))[0].id).not.toBe('shared');
		expect(await getSyncState(scopedStateKey(NOTE_IDB, 'tombstone-target'))).toEqual({
			shared: 100
		});
	});

	it('rolls back the append if a write fails', async () => {
		await putNote('failure-source', note('Synced note'));
		await bulkPutLabels('failure-source', [
			{ id: 'new-tag', name: 'Must roll back', createdAt: 1, updatedAt: 1 }
		]);
		await putNote('failure-target', note('Anonymous note'));
		const original = IDBObjectStore.prototype.put;
		const write = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
			this: IDBObjectStore,
			...args: Parameters<IDBObjectStore['put']>
		) {
			if (this.name === 'notes') throw new Error('Storage full');
			return original.apply(this, args);
		});
		try {
			await expect(unlinkProfileToNamespace('failure-source', 'failure-target')).rejects.toThrow(
				'Storage full'
			);
		} finally {
			write.mockRestore();
		}
		expect((await getAllNotesMetadata('failure-target')).map((note) => note.title)).toEqual([
			'Anonymous note'
		]);
		expect(await getAllLabels('failure-target')).toEqual([]);
		expect((await getAllNotesMetadata('failure-source'))[0].title).toBe('Synced note');
	});
});
