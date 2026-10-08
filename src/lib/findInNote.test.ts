import { describe, expect, it } from 'vitest';
import { findMatches, findShortcut, matchFrom, replaceInRow } from './findInNote.js';

describe('findMatches', () => {
	it('finds every match in reading order, ignoring case by default', () => {
		expect(findMatches(['Tea and tea', 'no', 'TEA'], 'tea', false)).toEqual([
			{ line: 0, start: 0, end: 3 },
			{ line: 0, start: 8, end: 11 },
			{ line: 2, start: 0, end: 3 }
		]);
	});

	it('matches case exactly when asked', () => {
		expect(findMatches(['Tea and tea'], 'tea', true)).toEqual([{ line: 0, start: 8, end: 11 }]);
	});

	it('treats the query as literal text', () => {
		expect(findMatches(['a.b axb (x) $5'], '.', false)).toEqual([{ line: 0, start: 1, end: 2 }]);
		expect(findMatches(['a.b axb (x) $5'], '(x)', false)).toEqual([{ line: 0, start: 8, end: 11 }]);
		expect(findMatches(['a.b axb (x) $5'], '$5', false)).toEqual([{ line: 0, start: 12, end: 14 }]);
	});

	it('does not overlap matches', () => {
		expect(findMatches(['aaaa'], 'aa', false)).toHaveLength(2);
	});

	it('finds nothing for an empty query', () => {
		expect(findMatches(['text'], '', false)).toEqual([]);
	});
});

describe('matchFrom', () => {
	const matches = findMatches(['one x', 'x two x'], 'x', false);

	it('picks the first match at or after the point', () => {
		expect(matchFrom(matches, 0, 0)).toBe(0);
		expect(matchFrom(matches, 0, 5)).toBe(1);
		expect(matchFrom(matches, 1, 1)).toBe(2);
	});

	it('wraps to the first match past the last one', () => {
		expect(matchFrom(matches, 1, 7)).toBe(0);
	});

	it('returns -1 without matches', () => {
		expect(matchFrom([], 0, 0)).toBe(-1);
	});
});

describe('replaceInRow', () => {
	it('replaces each match literally', () => {
		const row = 'tea and tea';
		const matches = findMatches([row], 'tea', false);

		expect(replaceInRow(row, matches, 'coffee $&')).toBe('coffee $& and coffee $&');
	});
});

describe('findShortcut', () => {
	function keys(init: Partial<KeyboardEvent>): KeyboardEvent {
		return {
			code: '',
			key: '',
			metaKey: false,
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
			...init
		} as KeyboardEvent;
	}

	it('uses Cmd on Apple platforms', () => {
		expect(findShortcut(keys({ code: 'KeyF', key: 'f', metaKey: true }), true)).toBe('find');
		expect(findShortcut(keys({ code: 'KeyF', key: 'ƒ', metaKey: true, altKey: true }), true)).toBe(
			'replace'
		);
		expect(findShortcut(keys({ code: 'KeyF', key: 'f', ctrlKey: true }), true)).toBeNull();
		expect(findShortcut(keys({ code: 'KeyH', key: 'h', ctrlKey: true }), true)).toBeNull();
		expect(findShortcut(keys({ code: 'KeyG', key: 'g', metaKey: true }), true)).toBe('next');
		expect(
			findShortcut(keys({ code: 'KeyG', key: 'G', metaKey: true, shiftKey: true }), true)
		).toBe('previous');
	});

	it('uses Ctrl elsewhere, with Ctrl+H for replace', () => {
		expect(findShortcut(keys({ code: 'KeyF', key: 'f', ctrlKey: true }), false)).toBe('find');
		expect(findShortcut(keys({ code: 'KeyH', key: 'h', ctrlKey: true }), false)).toBe('replace');
		expect(findShortcut(keys({ code: 'KeyF', key: 'f', metaKey: true }), false)).toBeNull();
	});

	it('steps with F3 and replaces all with Mod+Alt+Enter', () => {
		expect(findShortcut(keys({ key: 'F3' }), false)).toBe('next');
		expect(findShortcut(keys({ key: 'F3', shiftKey: true }), true)).toBe('previous');
		expect(findShortcut(keys({ key: 'Enter', ctrlKey: true, altKey: true }), false)).toBe(
			'replaceAll'
		);
	});
});
