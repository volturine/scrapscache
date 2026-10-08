/** A match of the find query inside one row of the note body. */
export type FindMatch = { line: number; start: number; end: number };

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every non-overlapping match of `query` in the rows, in reading order. The query is
 * literal text, and a match never spans two rows.
 */
export function findMatches(
	rows: readonly string[],
	query: string,
	caseSensitive: boolean
): FindMatch[] {
	if (query.length === 0) return [];
	const pattern = new RegExp(escapeRegExp(query), caseSensitive ? 'gu' : 'giu');
	const matches: FindMatch[] = [];
	rows.forEach((row, line) => {
		for (const found of row.matchAll(pattern)) {
			matches.push({ line, start: found.index, end: found.index + found[0].length });
		}
	});
	return matches;
}

/** The first match at or after the point, wrapping to the first match of the note. */
export function matchFrom(matches: readonly FindMatch[], line: number, offset: number): number {
	if (matches.length === 0) return -1;
	const index = matches.findIndex(
		(match) => match.line > line || (match.line === line && match.start >= offset)
	);
	return index < 0 ? 0 : index;
}

/** The row with each of its matches replaced by `replacement`, taken literally. */
export function replaceInRow(
	row: string,
	matches: readonly FindMatch[],
	replacement: string
): string {
	let next = row;
	for (const match of [...matches].sort((a, b) => b.start - a.start)) {
		next = next.slice(0, match.start) + replacement + next.slice(match.end);
	}
	return next;
}

export type FindShortcut = 'find' | 'replace' | 'next' | 'previous' | 'replaceAll';

type ShortcutKeys = Pick<
	KeyboardEvent,
	'code' | 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
>;

/**
 * VS Code's find keys: Cmd on Apple platforms and Ctrl elsewhere. Find is Mod+F;
 * replace is Cmd+Option+F on Apple and Ctrl+H elsewhere, where Ctrl+H is not the
 * Apple text field's delete-backward. Next and previous are F3 and Mod+G, with Shift
 * going back, and Mod+Alt+Enter replaces every match.
 */
export function findShortcut(event: ShortcutKeys, apple: boolean): FindShortcut | null {
	const mod = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
	if (mod && !event.shiftKey && event.code === 'KeyF') {
		if (!event.altKey) return 'find';
		return apple ? 'replace' : null;
	}
	if (!apple && mod && !event.altKey && !event.shiftKey && event.code === 'KeyH') return 'replace';
	if (event.key === 'F3' && !event.metaKey && !event.ctrlKey && !event.altKey) {
		return event.shiftKey ? 'previous' : 'next';
	}
	if (mod && !event.altKey && event.code === 'KeyG') return event.shiftKey ? 'previous' : 'next';
	if (mod && event.altKey && !event.shiftKey && event.key === 'Enter') return 'replaceAll';
	return null;
}
