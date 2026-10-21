import { afterEach, describe, expect, it } from 'vitest';
import { kanbanStore } from './kanban.svelte';
import { notesStore } from './notes.svelte';

afterEach(() => {
	notesStore.labels = [];
});

function board() {
	const created = kanbanStore.createBoard('Order');
	notesStore.labels = ['a', 'b', 'c'].map((id) => ({
		id,
		name: id.toUpperCase(),
		createdAt: 1,
		updatedAt: 1
	}));
	for (const id of ['a', 'b', 'c']) kanbanStore.addTagColumn(created.id, id);
	return created.id;
}

function labelsInOrder(boardId: string): (string | null)[] {
	return kanbanStore.boards
		.find((candidate) => candidate.id === boardId)!
		.columns.map((column) => column.labelId);
}

function columnId(boardId: string, labelId: string | null): string {
	return kanbanStore.boards
		.find((candidate) => candidate.id === boardId)!
		.columns.find((column) => column.labelId === labelId)!.id;
}

describe('moveColumn', () => {
	it('shifts a label column one place either way', () => {
		const id = board();
		expect(labelsInOrder(id)).toEqual([null, 'a', 'b', 'c']);

		kanbanStore.moveColumn(id, columnId(id, 'b'), 1);
		expect(labelsInOrder(id)).toEqual([null, 'a', 'c', 'b']);

		kanbanStore.moveColumn(id, columnId(id, 'b'), -1);
		kanbanStore.moveColumn(id, columnId(id, 'b'), -1);
		expect(labelsInOrder(id)).toEqual([null, 'b', 'a', 'c']);
	});

	it('keeps Unsorted first and the ends where they are', () => {
		const id = board();
		kanbanStore.moveColumn(id, columnId(id, 'a'), -1);
		kanbanStore.moveColumn(id, columnId(id, 'c'), 1);
		kanbanStore.moveColumn(id, columnId(id, null), 1);
		expect(labelsInOrder(id)).toEqual([null, 'a', 'b', 'c']);
	});
});
