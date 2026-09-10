import type { Note } from '$lib/types';
import { stableStringify } from '$lib/syncHash';
import { uid } from '$lib/utils';

export interface KanbanColumn {
	id: string;
	/** null is the fixed backlog; every other column is exactly one note tag. */
	labelId: string | null;
	/**
	 * Manual card order for this column, as note ids. Notes missing from it —
	 * newly created, or moved in from elsewhere — stay above the ordered ones in
	 * feed order, so a fresh note is never hidden at the bottom of a long column.
	 */
	order: string[];
}

export const BacklogFilterMode = {
	AllNonColumn: 'all-non-column',
	Custom: 'custom'
} as const;
export type BacklogFilterMode = (typeof BacklogFilterMode)[keyof typeof BacklogFilterMode];

/**
 * Controls which notes appear in the backlog column.
 * Notes that already match a tag column never appear here.
 *
 * - `all-non-column` (default): any note without a board tag-column label
 * - `custom`: only untagged and/or notes that carry one of `labelIds`
 */
export interface BacklogFilter {
	mode: BacklogFilterMode;
	includeUntagged: boolean;
	/** Tag ids that qualify a note for the backlog when mode is `custom`. */
	labelIds: string[];
}

export interface KanbanBoard {
	id: string;
	name: string;
	columns: KanbanColumn[];
	backlogFilter: BacklogFilter;
	/** Last configuration edit; this is the board's delta-sync version. */
	updatedAt: number;
}

export function defaultBacklogFilter(): BacklogFilter {
	return { mode: BacklogFilterMode.AllNonColumn, includeUntagged: true, labelIds: [] };
}

export function normalizeBacklogFilter(value: unknown): BacklogFilter {
	const fallback = defaultBacklogFilter();
	if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
	const raw = value as Partial<BacklogFilter>;
	const mode =
		raw.mode === BacklogFilterMode.Custom
			? BacklogFilterMode.Custom
			: BacklogFilterMode.AllNonColumn;
	const includeUntagged = raw.includeUntagged !== false;
	const labelIds = Array.isArray(raw.labelIds)
		? [
				...new Set(
					raw.labelIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
				)
			]
		: [];
	return { mode, includeUntagged, labelIds };
}

export function createKanbanBoard(name = 'Untitled board'): KanbanBoard {
	const now = Date.now();
	return {
		id: uid(),
		name: name.trim() || 'Untitled board',
		columns: [{ id: uid(), labelId: null, order: [] }],
		backlogFilter: defaultBacklogFilter(),
		updatedAt: now
	};
}

/** Label ids used by this board's non-backlog columns. */
export function boardColumnLabelIds(board: KanbanBoard): Set<string> {
	return new Set(
		board.columns.flatMap((candidate) => (candidate.labelId === null ? [] : [candidate.labelId]))
	);
}

/**
 * A note belongs in the backlog when it does not carry any board tag-column
 * label, and it matches the board's backlog filter.
 */
export function noteMatchesBacklog(board: KanbanBoard, note: Note): boolean {
	const columnLabels = boardColumnLabelIds(board);
	if (note.labels.some((labelId) => columnLabels.has(labelId))) return false;

	const filter = board.backlogFilter;
	if (filter.mode !== BacklogFilterMode.Custom) {
		return true;
	}

	if (filter.includeUntagged && note.labels.length === 0) return true;
	if (filter.labelIds.length === 0) return false;
	const allowed = new Set(filter.labelIds);
	return note.labels.some((labelId) => allowed.has(labelId));
}

/** Apply a column's manual order; unlisted notes keep their feed order on top. */
export function orderColumnNotes(notes: Note[], order: string[]): Note[] {
	if (order.length === 0) return notes;
	const rank = new Map(order.map((id, index) => [id, index]));
	return [...notes].sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1));
}

/**
 * A tag column contains notes with that tag. The backlog uses {@link noteMatchesBacklog}.
 */
export function columnNotes(board: KanbanBoard, column: KanbanColumn, notes: Note[]): Note[] {
	const columnLabelId = column.labelId;
	const members =
		columnLabelId !== null
			? notes.filter((note) => note.labels.includes(columnLabelId))
			: notes.filter((note) => noteMatchesBacklog(board, note));
	return orderColumnNotes(members, column.order);
}

/**
 * Place `noteId` at `visibleIndex` of a column's card list.
 *
 * Search hides cards, so the visible list is what the user aims at while the
 * stored order must keep the hidden ones: anchor on the visible card the drop
 * lands above and splice there, or append when it lands past the last one.
 */
export function insertIntoOrder(
	orderedIds: string[],
	visibleIds: string[],
	noteId: string,
	visibleIndex: number
): string[] {
	const rest = orderedIds.filter((id) => id !== noteId);
	const anchor = visibleIds.filter((id) => id !== noteId)[visibleIndex];
	const at = anchor === undefined ? rest.length : rest.indexOf(anchor);
	const position = at < 0 ? rest.length : at;
	return [...rest.slice(0, position), noteId, ...rest.slice(position)];
}

/** Newer boards win; equal timestamps use canonical content ordering on every device. */
export function mergeKanbanBoards(
	local: KanbanBoard[],
	remote: KanbanBoard[],
	tombstones: Record<string, number> = {}
): KanbanBoard[] {
	const byId = new Map(local.map((board) => [board.id, board]));
	for (const board of remote) {
		const current = byId.get(board.id);
		if (
			!current ||
			board.updatedAt > current.updatedAt ||
			(board.updatedAt === current.updatedAt && stableStringify(board) > stableStringify(current))
		) {
			byId.set(board.id, board);
		}
	}
	return [...byId.values()].filter(
		(board) => board.updatedAt > (Number(tombstones[board.id]) || 0)
	);
}

/**
 * Moving is deliberately label-only: remove the exact source tag and add the
 * destination tag. Labels outside the board are never changed.
 */
export function moveNoteLabels(
	labels: string[],
	sourceLabelId: string | null,
	destinationLabelId: string | null
): string[] {
	const withoutSource =
		sourceLabelId === null ? [...labels] : labels.filter((labelId) => labelId !== sourceLabelId);
	return destinationLabelId !== null && !withoutSource.includes(destinationLabelId)
		? [...withoutSource, destinationLabelId]
		: withoutSource;
}
