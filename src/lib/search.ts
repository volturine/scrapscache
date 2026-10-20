import type { Note, NoteColor } from './types.js';
import { noteAttachments } from './checklistBody.js';
import { isImageAttachment } from './noteImages.js';
import { isCanvasAttachment } from './canvasAttachment.js';
import { extractHttpUrls } from './linkPreview.js';
import { parseMarkdownBlocks } from './markdown.js';

/** What a note holds, as the Type chip narrows a search by it. */
export type SearchType = 'checklist' | 'image' | 'drawing' | 'link';

export const SEARCH_TYPES: readonly SearchType[] = ['checklist', 'image', 'drawing', 'link'];

export const TYPE_NAMES: Record<SearchType, string> = {
	checklist: 'Checklist',
	image: 'Image',
	drawing: 'Drawing',
	link: 'Link'
};

/** The chips under the search field; null is "any". */
export type SearchFilters = {
	label: string | null;
	color: NoteColor | null;
	type: SearchType | null;
};

export const NO_FILTERS: SearchFilters = { label: null, color: null, type: null };

export function activeFilterCount(filters: SearchFilters): number {
	return [filters.label, filters.color, filters.type].filter((value) => value !== null).length;
}

export function noteHasType(note: Note, type: SearchType): boolean {
	switch (type) {
		case 'checklist':
			// Parsed as the card shows it: a task-shaped line inside a code fence is code.
			return parseMarkdownBlocks(note.body ?? '').some(
				(block) => block.type === 'line' && block.segment.type === 'check'
			);
		case 'image':
			return noteAttachments(note).some(
				(attachment) => isImageAttachment(attachment) && !isCanvasAttachment(attachment)
			);
		case 'drawing':
			return noteAttachments(note).some(isCanvasAttachment);
		case 'link':
			return extractHttpUrls(note.body ?? '').length > 0;
	}
}

export function matchesFilters(note: Note, filters: SearchFilters): boolean {
	if (filters.label !== null && !note.labels.includes(filters.label)) return false;
	if (filters.color !== null && note.color !== filters.color) return false;
	if (filters.type !== null && !noteHasType(note, filters.type)) return false;
	return true;
}

export type MatchSegment = { text: string; match: boolean };
export type MatchRange = { start: number; end: number };

/**
 * Where `query` occurs in `text`, as ranges of the original string. The search
 * compares lowercased text, and some letters grow when lowercased (İ becomes two
 * code units), so every folded offset is mapped back to the character it came from.
 */
export function matchRanges(text: string, query: string): MatchRange[] {
	const needle = query.trim().toLowerCase();
	if (!needle || !text) return [];
	let folded = '';
	const origin: number[] = [];
	let at = 0;
	for (const character of text) {
		const low = character.toLowerCase();
		folded += low;
		for (let unit = 0; unit < low.length; unit += 1) origin.push(at);
		at += character.length;
	}
	origin.push(text.length);
	const ranges: MatchRange[] = [];
	let from = 0;
	for (;;) {
		const hit = folded.indexOf(needle, from);
		if (hit < 0) break;
		const start = origin[hit];
		const end = origin[hit + needle.length];
		if (end > start && (ranges.length === 0 || start >= ranges[ranges.length - 1].end))
			ranges.push({ start, end });
		from = hit + needle.length;
	}
	return ranges;
}

/** `text` cut by `ranges` (which cover `offset` onwards of a longer string) into matched and plain runs. */
function cut(text: string, offset: number, ranges: MatchRange[]): MatchSegment[] {
	if (!text) return [];
	const segments: MatchSegment[] = [];
	let from = 0;
	for (const range of ranges) {
		const start = Math.max(0, range.start - offset);
		const end = Math.min(text.length, range.end - offset);
		if (end <= from || start >= text.length) continue;
		if (start > from) segments.push({ text: text.slice(from, start), match: false });
		segments.push({ text: text.slice(start, end), match: true });
		from = end;
	}
	if (from < text.length) segments.push({ text: text.slice(from), match: false });
	return segments;
}

/**
 * `text` cut into the runs that match `query` (case-insensitive, every occurrence) and
 * the runs between them, so a card can mark why it was found. An empty query is one
 * unmatched run; empty text is no runs.
 */
export function matchSegments(text: string, query: string): MatchSegment[] {
	return cut(text, 0, matchRanges(text, query));
}

/**
 * Mark `query` across a run of display tokens as one text, so a match that crosses
 * a token boundary (a Markdown marker, a code token) is still marked in each part.
 */
export function markTokens<T extends { text: string }>(
	tokens: readonly T[],
	query: string
): { token: T; segments: MatchSegment[] }[] {
	const ranges = matchRanges(tokens.map((token) => token.text).join(''), query);
	let offset = 0;
	return tokens.map((token) => {
		const segments = cut(token.text, offset, ranges);
		offset += token.text.length;
		return { token, segments };
	});
}

/** "1 note" / "12 notes", under the chips. */
export function noteCount(count: number): string {
	return `${count} ${count === 1 ? 'note' : 'notes'}`;
}
