import { describe, expect, it } from 'vitest';
import {
	columnNotes,
	defaultBacklogFilter,
	insertIntoOrder,
	slotPosition,
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

describe('slotPosition', () => {
	// Three cards, the middle one being carried and so hidden from the column.
	const carrying = [false, true, false];

	it('puts the preview above the card on show it aims at', () => {
		expect(slotPosition(carrying, 0)).toBe(0);
	});

	it('counts past the hidden card rather than through it', () => {
		// Slot 1 is below the first card on show, which sits after the hidden one.
		expect(slotPosition(carrying, 1)).toBe(2);
	});

	it('ends the column when the drop aims past the last card on show', () => {
		expect(slotPosition(carrying, 2)).toBe(3);
	});

	it('needs no adjustment when nothing is carried', () => {
		expect(slotPosition([false, false, false], 0)).toBe(0);
		expect(slotPosition([false, false, false], 2)).toBe(2);
		expect(slotPosition([false, false, false], 3)).toBe(3);
	});

	it('handles a column holding only the carried card', () => {
		expect(slotPosition([true], 0)).toBe(1);
	});
});

describe('merging a board whose copy has no card order', () => {
	function boardWith(order: string[], updatedAt: number): KanbanBoard {
		return {
			...board,
			updatedAt,
			columns: board.columns.map((column) => (column.id === 'todo' ? { ...column, order } : column))
		};
	}

	function orderOf(boards: KanbanBoard[]): string[] {
		return boards[0].columns.find((column) => column.id === 'todo')!.order;
	}

	it('keeps a hand-arranged order a newer copy says nothing about', () => {
		const arranged = boardWith(['n2', 'n1'], 10);
		const newerWithout = boardWith([], 20);
		expect(orderOf(mergeKanbanBoards([arranged], [newerWithout]))).toEqual(['n2', 'n1']);
	});

	it('keeps it the other way round too', () => {
		const arranged = boardWith(['n2', 'n1'], 20);
		const olderWithout = boardWith([], 10);
		expect(orderOf(mergeKanbanBoards([olderWithout], [arranged]))).toEqual(['n2', 'n1']);
	});

	it('still lets a newer arrangement replace an older one', () => {
		const older = boardWith(['n1', 'n2'], 10);
		const newer = boardWith(['n2', 'n1'], 20);
		expect(orderOf(mergeKanbanBoards([older], [newer]))).toEqual(['n2', 'n1']);
	});

	it('leaves a column nobody ever arranged empty', () => {
		expect(orderOf(mergeKanbanBoards([boardWith([], 10)], [boardWith([], 20)]))).toEqual([]);
	});
});
