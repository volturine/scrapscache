import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { applyBoardTemplate, BOARD_TEMPLATES, labelNamed } from './kanbanTemplates';
import { kanbanStore } from './stores/kanban.svelte';
import { notesStore } from './stores/notes.svelte';
import { syncStore } from './stores/sync.svelte';

describe('board templates', () => {
	beforeEach(() => {
		localStorage.clear();
		const account = createSyncIdentity();
		const profile = {
			id: 'profile-kanban-templates',
			name: 'Kanban templates',
			syncKey: account.syncKey,
			createdAt: 1
		};
		syncStore.profiles = [profile];
		syncStore.activateProfile(profile);
		notesStore.notes = [];
		notesStore.labels = [];
	});

	afterEach(async () => {
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
	});

	function columnNames(boardId: string) {
		const board = kanbanStore.boards.find((candidate) => candidate.id === boardId)!;
		return board.columns.map((column) =>
			column.labelId === null ? 'Backlog' : notesStore.labelsById.get(column.labelId)?.name
		);
	}

	it('starts with the progress set the user asked for', () => {
		expect(BOARD_TEMPLATES[0].names).toEqual(['To-Do', 'In-Progress', 'Done']);
	});

	it('creates the labels a template needs and adds a column for each, in order', () => {
		const boardId = kanbanStore.createBoard('Templates').id;

		applyBoardTemplate(boardId, BOARD_TEMPLATES[0].names);

		expect(notesStore.labels.map((label) => label.name).sort()).toEqual([
			'Done',
			'In-Progress',
			'To-Do'
		]);
		expect(columnNames(boardId)).toEqual(['Backlog', 'To-Do', 'In-Progress', 'Done']);
	});

	it('reuses a label that already exists, whatever its case, and skips a column the board has', () => {
		const boardId = kanbanStore.createBoard('Reuse').id;
		const done = notesStore.createLabel('done')!;
		kanbanStore.addTagColumn(boardId, done.id);

		applyBoardTemplate(boardId, ['To-Do', 'Done']);

		expect(notesStore.labels).toHaveLength(2);
		expect(labelNamed('DONE')?.id).toBe(done.id);
		expect(columnNames(boardId)).toEqual(['Backlog', 'done', 'To-Do']);
	});
});
