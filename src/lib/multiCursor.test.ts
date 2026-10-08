import { describe, expect, it } from 'vitest';
import {
	allOccurrences,
	applyCursorEdit,
	multiCursorShortcut,
	nextOccurrence,
	wordAt,
	type Cursor
} from './multiCursor.js';

describe('wordAt', () => {
	it('picks the word around or just before the caret', () => {
		expect(wordAt('foo bar_1 baz', 5)).toEqual({ start: 4, end: 9 });
		expect(wordAt('foo bar', 3)).toEqual({ start: 0, end: 3 });
		expect(wordAt('naïve café', 2)).toEqual({ start: 0, end: 5 });
	});

	it('finds nothing between symbols or spaces', () => {
		expect(wordAt('a  - b', 3)).toBeNull();
	});
});

describe('allOccurrences', () => {
	it('matches case exactly, and whole words when asked', () => {
		const rows = ['cat Cat category', 'cat'];

		expect(allOccurrences(rows, 'cat', false)).toEqual([
			{ line: 0, start: 0, end: 3 },
			{ line: 0, start: 8, end: 11 },
			{ line: 1, start: 0, end: 3 }
		]);
		expect(allOccurrences(rows, 'cat', true)).toEqual([
			{ line: 0, start: 0, end: 3 },
			{ line: 1, start: 0, end: 3 }
		]);
	});
});

describe('nextOccurrence', () => {
	const rows = ['x a x', 'x'];
	const first: Cursor = { line: 0, start: 0, end: 1 };

	it('takes the next free occurrence after the last one added', () => {
		expect(nextOccurrence(rows, 'x', first, [first], true)).toEqual({ line: 0, start: 4, end: 5 });
	});

	it('wraps to the start of the note', () => {
		const last: Cursor = { line: 1, start: 0, end: 1 };
		const taken = [last, { line: 0, start: 4, end: 5 }];

		expect(nextOccurrence(rows, 'x', last, taken, true)).toEqual(first);
	});

	it('returns null once every occurrence is taken', () => {
		const taken = allOccurrences(rows, 'x', true);

		expect(nextOccurrence(rows, 'x', first, taken, true)).toBeNull();
	});
});

describe('applyCursorEdit', () => {
	it('replaces every selection with typed text and collapses after it', () => {
		const rows = ['cat and cat', 'cat'];
		const cursors = allOccurrences(rows, 'cat', true);

		const result = applyCursorEdit(rows, cursors, { kind: 'insert', text: 'dog' });

		expect([...result.changed.entries()]).toEqual([
			[0, 'dog and dog'],
			[1, 'dog']
		]);
		expect(result.cursors).toEqual([
			{ line: 0, start: 3, end: 3 },
			{ line: 0, start: 11, end: 11 },
			{ line: 1, start: 3, end: 3 }
		]);
	});

	it('keeps the given cursor order, so the primary stays first', () => {
		const cursors = [
			{ line: 0, start: 4, end: 4 },
			{ line: 0, start: 0, end: 0 }
		];

		const result = applyCursorEdit(['ab  cd'], cursors, { kind: 'insert', text: '-' });

		expect(result.changed.get(0)).toBe('-ab  -cd');
		expect(result.cursors).toEqual([
			{ line: 0, start: 6, end: 6 },
			{ line: 0, start: 1, end: 1 }
		]);
	});

	it('deletes a character at each caret, skipping a caret at the row start', () => {
		const cursors = [
			{ line: 0, start: 2, end: 2 },
			{ line: 1, start: 0, end: 0 }
		];

		const result = applyCursorEdit(['abc', 'def'], cursors, { kind: 'deleteBackward' });

		expect([...result.changed.entries()]).toEqual([[0, 'ac']]);
		expect(result.cursors).toEqual([
			{ line: 0, start: 1, end: 1 },
			{ line: 1, start: 0, end: 0 }
		]);
	});

	it('deletes forward and never splits an emoji', () => {
		const result = applyCursorEdit(['😀x😀'], [{ line: 0, start: 0, end: 0 }], {
			kind: 'deleteForward'
		});
		expect(result.changed.get(0)).toBe('x😀');

		const back = applyCursorEdit(['😀x😀'], [{ line: 0, start: 5, end: 5 }], {
			kind: 'deleteBackward'
		});
		expect(back.changed.get(0)).toBe('😀x');
	});

	it('merges carets that meet', () => {
		const cursors = [
			{ line: 0, start: 1, end: 1 },
			{ line: 0, start: 2, end: 2 }
		];

		const result = applyCursorEdit(['abc'], cursors, { kind: 'deleteForward' });

		expect(result.changed.get(0)).toBe('a');
		expect(result.cursors).toEqual([{ line: 0, start: 1, end: 1 }]);
	});
});

describe('multiCursorShortcut', () => {
	function keys(init: Partial<KeyboardEvent>): KeyboardEvent {
		return {
			code: '',
			metaKey: false,
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
			...init
		} as KeyboardEvent;
	}

	it('uses Cmd on Apple platforms and Ctrl elsewhere', () => {
		expect(multiCursorShortcut(keys({ code: 'KeyD', metaKey: true }), true)).toBe('addNext');
		expect(multiCursorShortcut(keys({ code: 'KeyD', ctrlKey: true }), true)).toBeNull();
		expect(multiCursorShortcut(keys({ code: 'KeyD', ctrlKey: true }), false)).toBe('addNext');
		expect(multiCursorShortcut(keys({ code: 'KeyL', ctrlKey: true, shiftKey: true }), false)).toBe(
			'selectAll'
		);
		expect(
			multiCursorShortcut(keys({ code: 'KeyD', ctrlKey: true, shiftKey: true }), false)
		).toBeNull();
	});
});
