import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { moveCardToColumn } from './kanbanMove';
import { actionUndo } from './stores/actionUndo.svelte';
import { kanbanStore } from './stores/kanban.svelte';
import { notesStore } from './stores/notes.svelte';
import { syncStore } from './stores/sync.svelte';

describe('moveCardToColumn', () => {
	beforeEach(() => {
		localStorage.clear();
		actionUndo.clear();
		const account = createSyncIdentity();
		const profile = {
			id: 'profile-kanban-move',
			name: 'Kanban move',
			syncKey: account.syncKey,
			createdAt: 1
		};
		syncStore.profiles = [profile];
		syncStore.activateProfile(profile);
		notesStore.notes = [];
		notesStore.labels = [];
	});

	afterEach(async () => {
		// Queued writes must land before the setup drops the test databases.
		await notesStore.waitForPendingProfileWrites();
		const internals = notesStore as unknown as {
			dirty: boolean;
			syncPushTimer: ReturnType<typeof setTimeout> | null;
		};
		if (internals.syncPushTimer) clearTimeout(internals.syncPushTimer);
		internals.syncPushTimer = null;
		internals.dirty = false;
		syncStore.account = null;
		syncStore.profiles = [];
		notesStore.notes = [];
		notesStore.labels = [];
		actionUndo.clear();
	});

	/** Todo holds A, B, C in that order; Doing and Done are empty. */
	function setUpBoard() {
		const boardId = kanbanStore.boards[0].id;
		const todo = notesStore.createLabel('Todo')!;
		const doing = notesStore.createLabel('Doing')!;
		const done = notesStore.createLabel('Done')!;
		for (const label of [todo, doing, done]) kanbanStore.addTagColumn(boardId, label.id);
		const [a, b, c] = ['A', 'B', 'C'].map(
			(title) => notesStore.createNote({ title, labels: [todo.id] }).id
		);
		reorder(boardId, todo.id, [a, b, c]);
		return { boardId, todo: todo.id, doing: doing.id, done: done.id, a, b, c };
	}

	/** Read back from the board each time, since every edit replaces the columns. */
	function column(labelId: string) {
		return kanbanStore.boards[0].columns.find((item) => item.labelId === labelId)!;
	}

	function reorder(boardId: string, labelId: string, order: string[]) {
		const id = column(labelId).id;
		kanbanStore.placeCard(boardId, order[0], id, id, order);
	}

	function labelsOf(noteId: string) {
		return notesStore.notes.find((note) => note.id === noteId)?.labels;
	}

	/** Drag a card from one column to another, landing at `at` (the end by default). */
	function move(boardId: string, noteId: string, from: string, to: string, at?: number) {
		const destination = column(to);
		const order = destination.order.filter((id) => id !== noteId);
		order.splice(at ?? order.length, 0, noteId);
		moveCardToColumn({
			boardId,
			noteId,
			source: column(from),
			destination,
			order,
			message: 'Moved'
		});
	}

	it('relabels the card and places it in the destination column', () => {
		const { boardId, todo, doing, b } = setUpBoard();

		move(boardId, b, todo, doing);

		expect(labelsOf(b)).toEqual([doing]);
		expect(column(doing).order).toEqual([b]);
		expect(column(todo).order).not.toContain(b);
		expect(actionUndo.bar).toBe('Moved');
	});

	it('puts the card back in its slot among the others, and redo moves it again', () => {
		const { boardId, todo, doing, a, b, c } = setUpBoard();
		move(boardId, b, todo, doing);

		actionUndo.undo();
		expect(labelsOf(b)).toEqual([todo]);
		expect(column(todo).order).toEqual([a, b, c]);
		expect(column(doing).order).toEqual([]);

		actionUndo.redo();
		expect(labelsOf(b)).toEqual([doing]);
		expect(column(todo).order).toEqual([a, c]);
		expect(column(doing).order).toEqual([b]);
	});

	it('keeps a label added after the move', () => {
		const { boardId, todo, doing, b } = setUpBoard();
		const urgent = notesStore.createLabel('Urgent')!;
		move(boardId, b, todo, doing);
		notesStore.updateNote(b, { labels: [...labelsOf(b)!, urgent.id] });

		actionUndo.undo();

		expect(labelsOf(b)).toEqual([urgent.id, todo]);
	});

	it('keeps a reorder of the source column made after the move', () => {
		const { boardId, todo, doing, a, b, c } = setUpBoard();
		move(boardId, b, todo, doing);
		reorder(boardId, todo, [c, a]);

		actionUndo.undo();

		// Back in front of C, the card that followed it; C still before A.
		expect(column(todo).order).toEqual([b, c, a]);
	});

	it('keeps a reorder of the source column that arrived from another device', () => {
		const { boardId, todo, doing, a, b, c } = setUpBoard();
		move(boardId, b, todo, doing);
		const [remote] = kanbanStore.boardsForSync();
		const remoteTodo = remote.columns.find((item) => item.labelId === todo)!;
		remoteTodo.order = [c, 'from-elsewhere', a];
		remoteTodo.orderedAt = (column(todo).orderedAt ?? 0) + 60_000;
		kanbanStore.applySync([remote]);
		expect(column(todo).order).toEqual([c, 'from-elsewhere', a]);

		actionUndo.undo();

		expect(column(todo).order).toEqual([b, c, 'from-elsewhere', a]);
	});

	it.each([
		[
			'moved on with Tag note',
			(ids: ReturnType<typeof setUpBoard>) => notesStore.updateNote(ids.b, { labels: [ids.done] })
		],
		['trashed', (ids: ReturnType<typeof setUpBoard>) => notesStore.trashNote(ids.b)],
		['archived', (ids: ReturnType<typeof setUpBoard>) => notesStore.toggleArchive(ids.b)],
		[
			'without its source label',
			(ids: ReturnType<typeof setUpBoard>) => notesStore.removeLabel(ids.todo)
		],
		[
			'without its source column',
			(ids: ReturnType<typeof setUpBoard>) =>
				kanbanStore.removeTagColumn(ids.boardId, column(ids.todo).id)
		]
	])('leaves a card alone once it is %s', (_, overtake) => {
		const ids = setUpBoard();
		move(ids.boardId, ids.b, ids.todo, ids.doing);
		// The undo step for the move is the one to test, whatever the overtaking edit records.
		const step = actionUndo.past.at(-1)!;
		overtake(ids);
		const labelsBefore = labelsOf(ids.b);
		const ordersBefore = kanbanStore.boards[0].columns.map((item) => [...item.order]);

		step.undo();

		expect(labelsOf(ids.b)).toEqual(labelsBefore);
		expect(kanbanStore.boards[0].columns.map((item) => [...item.order])).toEqual(ordersBefore);
	});

	it('undoes two moves in turn back to the original order', () => {
		const { boardId, todo, doing, a, b, c } = setUpBoard();
		move(boardId, a, todo, doing);
		move(boardId, b, todo, doing);

		actionUndo.undo();
		actionUndo.undo();

		expect(column(todo).order).toEqual([a, b, c]);
		expect(labelsOf(a)).toEqual([todo]);
		expect(labelsOf(b)).toEqual([todo]);
		expect(column(doing).order).toEqual([]);
	});

	it('keeps a reorder of the destination made between undo and redo', () => {
		const { boardId, todo, doing, b } = setUpBoard();
		const [x, y] = ['X', 'Y'].map((title) => notesStore.createNote({ title, labels: [doing] }).id);
		reorder(boardId, doing, [x, y]);
		move(boardId, b, todo, doing, 1);
		expect(column(doing).order).toEqual([x, b, y]);

		actionUndo.undo();
		reorder(boardId, doing, [y, x]);
		actionUndo.redo();

		// Back in front of Y, the card that followed it; Y still before X.
		expect(column(doing).order).toEqual([b, y, x]);
	});

	it('records no step for a card that no longer exists', () => {
		const { boardId, todo, doing, b } = setUpBoard();
		notesStore.notes = notesStore.notes.filter((note) => note.id !== b);

		move(boardId, b, todo, doing);

		expect(actionUndo.past).toHaveLength(0);
		expect(actionUndo.bar).toBeNull();
		expect(column(doing).order).toEqual([b]);
	});
});
