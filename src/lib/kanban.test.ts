import { describe, expect, it } from 'vitest';
import {
	columnNotes,
	defaultBacklogFilter,
	insertIntoOrder,
	mergeKanbanBoards,
	moveNoteLabels,
	noteMatchesBacklog,
	orderColumnNotes,
	type KanbanBoard
} from './kanban';
import type { Note } from './types';

const board: KanbanBoard = {
	id: 'board',
	name: 'Work',
	updatedAt: 10,
	backlogFilter: defaultBacklogFilter(),
	columns: [
		{ id: 'backlog', labelId: null, order: [] },
		{ id: 'todo', labelId: 'todo-label', order: [] },
		{ id: 'done', labelId: 'done-label', order: [] }
	]
};

function note(id: string, labels: string[]): Note {
	return {
		id,
		title: id,
		body: '',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels
	};
}

describe('Kanban board tag mapping', () => {
	it('puts notes without this board’s tags in the backlog, even when they use other labels', () => {
		const notes = [
			note('unlabelled', []),
			note('personal', ['personal-label']),
			note('todo', ['todo-label'])
		];

		expect(columnNotes(board, board.columns[0], notes).map((item) => item.id)).toEqual([
			'unlabelled',
			'personal'
		]);
		expect(columnNotes(board, board.columns[1], notes).map((item) => item.id)).toEqual(['todo']);
	});

	it('filters backlog to untagged and selected tags in custom mode', () => {
		const custom: KanbanBoard = {
			...board,
			backlogFilter: {
				mode: 'custom',
				includeUntagged: true,
				labelIds: ['personal-label']
			}
		};
		const notes = [
			note('unlabelled', []),
			note('personal', ['personal-label']),
			note('other', ['other-label']),
			note('todo', ['todo-label'])
		];

		expect(columnNotes(custom, custom.columns[0], notes).map((item) => item.id)).toEqual([
			'unlabelled',
			'personal'
		]);
		expect(noteMatchesBacklog(custom, note('other', ['other-label']))).toBe(false);
		expect(noteMatchesBacklog(custom, note('todo', ['todo-label']))).toBe(false);
	});

	it('can hide untagged notes from the backlog', () => {
		const custom: KanbanBoard = {
			...board,
			backlogFilter: {
				mode: 'custom',
				includeUntagged: false,
				labelIds: ['personal-label']
			}
		};
		const notes = [note('unlabelled', []), note('personal', ['personal-label'])];
		expect(columnNotes(custom, custom.columns[0], notes).map((item) => item.id)).toEqual([
			'personal'
		]);
	});

	it('moves only the exact source column tag and retains unrelated labels', () => {
		expect(moveNoteLabels(['personal-label', 'todo-label'], 'todo-label', 'done-label')).toEqual([
			'personal-label',
			'done-label'
		]);
		expect(moveNoteLabels(['personal-label', 'todo-label'], 'todo-label', null)).toEqual([
			'personal-label'
		]);
		expect(moveNoteLabels(['personal-label'], null, 'todo-label')).toEqual([
			'personal-label',
			'todo-label'
		]);
	});

	it('takes the newer board from sync and never revives a tombstoned board', () => {
		const remote: KanbanBoard = { ...board, name: 'Remote work', updatedAt: 20 };
		expect(mergeKanbanBoards([board], [remote], {})).toEqual([remote]);
		expect(mergeKanbanBoards([remote], [board], { board: 30 })).toEqual([]);
	});

	it('drops a board only when its tombstone is newer than its last edit', () => {
		const stale: KanbanBoard = { ...board, updatedAt: 20 };
		const edited: KanbanBoard = { ...board, name: 'Edited after delete', updatedAt: 40 };
		expect(mergeKanbanBoards([stale], [], { board: 30 })).toEqual([]);
		expect(mergeKanbanBoards([edited], [], { board: 30 })).toEqual([edited]);
	});
});

describe('column card order', () => {
	it('keeps feed order until a column is ordered by hand', () => {
		const notes = [note('a', []), note('b', []), note('c', [])];
		expect(orderColumnNotes(notes, []).map((n) => n.id)).toEqual(['a', 'b', 'c']);
	});

	it('follows the stored order and floats unlisted notes to the top', () => {
		const notes = [note('a', []), note('b', []), note('fresh', [])];
		expect(orderColumnNotes(notes, ['b', 'a']).map((n) => n.id)).toEqual(['fresh', 'b', 'a']);
	});

	it('orders the cards a column shows', () => {
		const ordered: KanbanBoard = {
			...board,
			columns: board.columns.map((column) =>
				column.id === 'todo' ? { ...column, order: ['n2', 'n1'] } : column
			)
		};
		const notes = [note('n1', ['todo-label']), note('n2', ['todo-label'])];
		expect(columnNotes(ordered, ordered.columns[1], notes).map((n) => n.id)).toEqual(['n2', 'n1']);
	});
});

describe('insertIntoOrder', () => {
	it('places a card above the one it was dropped on', () => {
		expect(insertIntoOrder(['a', 'b', 'c'], ['a', 'b', 'c'], 'x', 1)).toEqual(['a', 'x', 'b', 'c']);
	});

	it('appends when the drop lands past the last card', () => {
		expect(insertIntoOrder(['a', 'b'], ['a', 'b'], 'x', 2)).toEqual(['a', 'b', 'x']);
	});

	it('moves a card already in the column instead of duplicating it', () => {
		expect(insertIntoOrder(['a', 'b', 'c'], ['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
	});

	it('splices at the visible anchor so search-hidden cards keep their place', () => {
		// 'b' is hidden by a search; dropping above visible 'c' must land above 'c'.
		expect(insertIntoOrder(['a', 'b', 'c'], ['a', 'c'], 'x', 1)).toEqual(['a', 'b', 'x', 'c']);
	});
});
