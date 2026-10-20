import type { Note, NoteColor } from './types.js';
import { noteAttachments } from './checklistBody.js';
import { CHECK_RE } from './checklistBody.js';
import { isImageAttachment } from './noteImages.js';
import { isCanvasAttachment } from './canvasAttachment.js';
import { extractHttpUrls } from './linkPreview.js';

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
			return (note.body ?? '').split('\n').some((line) => CHECK_RE.test(line));
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

/**
 * `text` cut into the runs that match `query` (case-insensitive, every occurrence) and
 * the runs between them, so a card can mark why it was found. An empty query is one
 * unmatched run; empty text is no runs.
 */
export function matchSegments(text: string, query: string): MatchSegment[] {
	if (!text) return [];
	const needle = query.trim().toLowerCase();
	if (!needle) return [{ text, match: false }];
	const haystack = text.toLowerCase();
	const segments: MatchSegment[] = [];
	let from = 0;
	for (;;) {
		const at = haystack.indexOf(needle, from);
		if (at < 0) break;
		if (at > from) segments.push({ text: text.slice(from, at), match: false });
		segments.push({ text: text.slice(at, at + needle.length), match: true });
		from = at + needle.length;
	}
	if (from < text.length) segments.push({ text: text.slice(from), match: false });
	return segments;
}

/** "1 note" / "12 notes", under the chips. */
export function noteCount(count: number): string {
	return `${count} ${count === 1 ? 'note' : 'notes'}`;
}
