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

	/** A card in Todo, with Todo and Doing columns on the first board. */
	function setUpCard() {
		const todo = notesStore.createLabel('Todo')!;
		const doing = notesStore.createLabel('Doing')!;
		const card = notesStore.createNote({ title: 'Card', labels: [todo.id] });
		const boardId = kanbanStore.boards[0].id;
		kanbanStore.addTagColumn(boardId, todo.id);
		kanbanStore.addTagColumn(boardId, doing.id);
		// The card sits in Todo's order, as it does after a drop there.
		const todoColumn = column(todo.id);
		kanbanStore.placeCard(boardId, card.id, todoColumn.id, todoColumn.id, [card.id]);
		return { boardId, card, todo, doing };
	}

	function note(id: string) {
		return notesStore.notes.find((item) => item.id === id);
	}

	/** Read back from the board each time, since every edit replaces the columns. */
	function column(labelId: string) {
		return kanbanStore.boards[0].columns.find((item) => item.labelId === labelId)!;
	}

	it('relabels the card and places it in the destination column', () => {
		const { boardId, card, todo, doing } = setUpCard();

		moveCardToColumn({
			boardId,
			noteId: card.id,
			source: column(todo.id),
			destination: column(doing.id),
			order: [card.id],
			message: 'Moved to Doing'
		});

		expect(note(card.id)?.labels).toEqual([doing.id]);
		expect(column(doing.id).order).toEqual([card.id]);
		expect(column(todo.id).order).toEqual([]);
		expect(actionUndo.bar).toBe('Moved to Doing');
	});

	it('restores the old label and column order on undo, and moves it again on redo', () => {
		const { boardId, card, todo, doing } = setUpCard();
		moveCardToColumn({
			boardId,
			noteId: card.id,
			source: column(todo.id),
			destination: column(doing.id),
			order: [card.id],
			message: 'Moved to Doing'
		});

		actionUndo.undo();

		expect(note(card.id)?.labels).toEqual([todo.id]);
		expect(column(todo.id).order).toEqual([card.id]);
		expect(column(doing.id).order).not.toContain(card.id);
		expect(actionUndo.bar).toBeNull();

		actionUndo.redo();

		expect(note(card.id)?.labels).toEqual([doing.id]);
		expect(column(doing.id).order).toEqual([card.id]);
		expect(column(todo.id).order).toEqual([]);
		expect(actionUndo.bar).toBe('Moved to Doing');
	});

	it('records no step for a card that no longer exists', () => {
		const { boardId, card, todo, doing } = setUpCard();
		notesStore.notes = [];

		moveCardToColumn({
			boardId,
			noteId: card.id,
			source: column(todo.id),
			destination: column(doing.id),
			order: [card.id],
			message: 'Moved to Doing'
		});

		expect(actionUndo.past).toHaveLength(0);
		expect(actionUndo.bar).toBeNull();
		expect(column(doing.id).order).toEqual([card.id]);
	});
});
