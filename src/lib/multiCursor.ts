/**
 * A selection inside one row. `start` equals `end` for a bare caret; the caret is
 * drawn at `end`, as VS Code draws it after Cmd+D.
 */
export type Cursor = { line: number; start: number; end: number };

export type CursorEdit =
	{ kind: 'insert'; text: string } | { kind: 'deleteBackward' } | { kind: 'deleteForward' };

const WORD = /[\p{L}\p{N}_]/u;

function isWordAt(text: string, index: number): boolean {
	return index >= 0 && index < text.length && WORD.test(text[index]);
}

/** The word touching `offset`, as VS Code's Cmd+D picks it from a bare caret. */
export function wordAt(text: string, offset: number): { start: number; end: number } | null {
	let start = offset;
	let end = offset;
	if (!isWordAt(text, offset) && !isWordAt(text, offset - 1)) return null;
	while (isWordAt(text, start - 1)) start--;
	while (isWordAt(text, end)) end++;
	return { start, end };
}

function occurrencesInRow(row: string, line: number, needle: string, wholeWord: boolean): Cursor[] {
	const found: Cursor[] = [];
	for (let at = row.indexOf(needle); at >= 0; at = row.indexOf(needle, at + needle.length)) {
		const end = at + needle.length;
		if (wholeWord && (isWordAt(row, at - 1) || isWordAt(row, end))) continue;
		found.push({ line, start: at, end });
	}
	return found;
}

/** Every case-sensitive occurrence of `needle`, in reading order. */
export function allOccurrences(
	rows: readonly string[],
	needle: string,
	wholeWord: boolean
): Cursor[] {
	if (needle.length === 0) return [];
	return rows.flatMap((row, line) => occurrencesInRow(row, line, needle, wholeWord));
}

export function sameCursor(a: Cursor, b: Cursor): boolean {
	return a.line === b.line && a.start === b.start && a.end === b.end;
}

/**
 * The first occurrence after `after` that is not already selected, wrapping past
 * the end of the note; null once every occurrence is taken.
 */
export function nextOccurrence(
	rows: readonly string[],
	needle: string,
	after: Cursor,
	taken: readonly Cursor[],
	wholeWord: boolean
): Cursor | null {
	const free = allOccurrences(rows, needle, wholeWord).filter(
		(cursor) => !taken.some((other) => sameCursor(cursor, other))
	);
	const later = free.find(
		(cursor) =>
			cursor.line > after.line || (cursor.line === after.line && cursor.start >= after.end)
	);
	return later ?? free[0] ?? null;
}

/** Length of the code point that ends at `index`, so a deletion never splits a surrogate pair. */
function codePointBefore(text: string, index: number): number {
	const low = text.charCodeAt(index - 1);
	const high = text.charCodeAt(index - 2);
	return low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? 2 : 1;
}

function codePointAt(text: string, index: number): number {
	return (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
}

/**
 * Applies one edit at every cursor. Returns the rows it changed and the cursors,
 * collapsed after the edit, in the order they were given; cursors that end up on
 * the same spot keep only the first.
 */
export function applyCursorEdit(
	rows: readonly string[],
	cursors: readonly Cursor[],
	edit: CursorEdit
): { changed: Map<number, string>; cursors: Cursor[] } {
	const spans = cursors.map((cursor) => {
		const row = rows[cursor.line] ?? '';
		let { start, end } = cursor;
		if (start === end && edit.kind === 'deleteBackward' && start > 0) {
			start -= codePointBefore(row, start);
		} else if (start === end && edit.kind === 'deleteForward' && end < row.length) {
			end += codePointAt(row, end);
		}
		return { line: cursor.line, start, end, text: edit.kind === 'insert' ? edit.text : '' };
	});

	const changed = new Map<number, string>();
	const placed: Cursor[] = new Array(spans.length);
	const byLine = new Map<number, number[]>();
	spans.forEach((span, index) => byLine.set(span.line, [...(byLine.get(span.line) ?? []), index]));
	for (const [line, indexes] of byLine) {
		const row = rows[line] ?? '';
		indexes.sort((a, b) => spans[a].start - spans[b].start);
		let next = '';
		let read = 0;
		for (const index of indexes) {
			const span = spans[index];
			// A span that overlaps an earlier one starts where that one stopped.
			const start = Math.max(span.start, read);
			const end = Math.max(span.end, start);
			next += row.slice(read, start) + span.text;
			read = end;
			placed[index] = { line, start: next.length, end: next.length };
		}
		next += row.slice(read);
		if (next !== row) changed.set(line, next);
	}

	const unique = placed.filter(
		(cursor, index) => placed.findIndex((other) => sameCursor(other, cursor)) === index
	);
	return { changed, cursors: unique };
}

export type MultiCursorShortcut = 'addNext' | 'selectAll';

type ShortcutKeys = Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

/** VS Code's Mod+D and Mod+Shift+L: Cmd on Apple platforms, Ctrl elsewhere. */
export function multiCursorShortcut(
	event: ShortcutKeys,
	apple: boolean
): MultiCursorShortcut | null {
	const mod = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
	if (!mod || event.altKey) return null;
	if (event.code === 'KeyD' && !event.shiftKey) return 'addNext';
	if (event.code === 'KeyL' && event.shiftKey) return 'selectAll';
	return null;
}
