import type { Note } from '$lib/types';
import { pickLatest, stableStringify, type EditContext } from '$lib/model';
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
	/** When `order` was last arranged, and by whom; each column's order merges on its own. */
	orderedAt?: number;
	orderWriter?: string;
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

export const BoardNoteFilterAction = {
	Keep: 'keep',
	Remove: 'remove'
} as const;
export type BoardNoteFilterAction =
	(typeof BoardNoteFilterAction)[keyof typeof BoardNoteFilterAction];

/**
 * Controls which notes appear anywhere on a board, backlog included, by label.
 * Every column stays on show; only the notes in them are filtered.
 *
 * The labels and the action are chosen independently: `keep` shows only notes
 * carrying one of `labelIds`, `remove` hides them. With no labels selected the
 * filter is off, whichever action is set.
 *
 * Column labels are never part of it: a column already chooses its notes by
 * its own label.
 */
export interface BoardNoteFilter {
	action: BoardNoteFilterAction;
	labelIds: string[];
}

/** Board settings that merge independently; `columns` is the set and sequence of columns. */
export type BoardField = 'name' | 'backlogFilter' | 'noteFilter' | 'columns';

const BOARD_FIELDS: BoardField[] = ['name', 'backlogFilter', 'noteFilter', 'columns'];

export interface KanbanBoard {
	id: string;
	name: string;
	columns: KanbanColumn[];
	backlogFilter: BacklogFilter;
	noteFilter: BoardNoteFilter;
	/** Last configuration edit; this is the board's delta-sync version. */
	updatedAt: number;
	/** Per-setting write times and writers; missing times fall back to `updatedAt`. */
	fieldTimes?: Partial<Record<BoardField, number>>;
	fieldWriters?: Partial<Record<BoardField, string>>;
}

export function defaultBacklogFilter(): BacklogFilter {
	return { mode: BacklogFilterMode.AllNonColumn, includeUntagged: true, labelIds: [] };
}

export function defaultBoardNoteFilter(): BoardNoteFilter {
	return { action: BoardNoteFilterAction.Keep, labelIds: [] };
}

function uniqueIds(value: unknown): string[] {
	return Array.isArray(value)
		? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
		: [];
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
	return { mode, includeUntagged, labelIds: uniqueIds(raw.labelIds) };
}

export function normalizeBoardNoteFilter(value: unknown): BoardNoteFilter {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultBoardNoteFilter();
	const raw = value as Partial<BoardNoteFilter>;
	const action =
		raw.action === BoardNoteFilterAction.Remove
			? BoardNoteFilterAction.Remove
			: BoardNoteFilterAction.Keep;
	return { action, labelIds: uniqueIds(raw.labelIds) };
}

type StoredBoard = {
	id?: unknown;
	name?: unknown;
	columns?: unknown;
	backlogFilter?: unknown;
	noteFilter?: unknown;
	updatedAt?: unknown;
	fieldTimes?: unknown;
	fieldWriters?: unknown;
};

function boardFieldMap<T>(
	value: unknown,
	parse: (entry: unknown) => T | undefined
): Partial<Record<BoardField, T>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).flatMap(([field, entry]) => {
			const parsed = parse(entry);
			return (BOARD_FIELDS as string[]).includes(field) && parsed !== undefined
				? [[field, parsed]]
				: [];
		})
	);
}

const positiveTime = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
const writerId = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

/** The one validating copy of a board, for storage, sync, and backups alike. */
export function normalizeBoard(value: unknown): KanbanBoard | null {
	if (!value || typeof value !== 'object') return null;
	const board = value as StoredBoard;
	if (
		typeof board.id !== 'string' ||
		typeof board.name !== 'string' ||
		!Array.isArray(board.columns)
	)
		return null;

	const usedLabels = new Set<string>();
	let hasBacklog = false;
	const columns = board.columns.flatMap((column): KanbanColumn[] => {
		if (!column || typeof column !== 'object') return [];
		const candidate = column as {
			id?: unknown;
			labelId?: unknown;
			order?: unknown;
			orderedAt?: unknown;
			orderWriter?: unknown;
		};
		if (
			typeof candidate.id !== 'string' ||
			(candidate.labelId !== null && typeof candidate.labelId !== 'string')
		)
			return [];
		const labelId = candidate.labelId;
		const order = Array.isArray(candidate.order)
			? [...new Set(candidate.order.filter((id): id is string => typeof id === 'string' && !!id))]
			: [];
		if (labelId === null) {
			if (hasBacklog) return [];
			hasBacklog = true;
		} else {
			if (usedLabels.has(labelId)) return [];
			usedLabels.add(labelId);
		}
		const orderedAt = positiveTime(candidate.orderedAt);
		const orderWriter = writerId(candidate.orderWriter);
		return [
			{
				id: candidate.id,
				labelId,
				order,
				...(orderedAt !== undefined ? { orderedAt } : {}),
				...(orderWriter ? { orderWriter } : {})
			}
		];
	});
	if (!hasBacklog) columns.unshift({ id: uid(), labelId: null, order: [] });
	const backlogFilter = normalizeBacklogFilter(board.backlogFilter);
	// A tag cannot be both a column and a backlog filter tag.
	backlogFilter.labelIds = backlogFilter.labelIds.filter((labelId) => !usedLabels.has(labelId));
	const fieldTimes = boardFieldMap(board.fieldTimes, positiveTime);
	const fieldWriters = boardFieldMap(board.fieldWriters, writerId);
	return {
		id: board.id,
		name: board.name.trim() || 'Untitled board',
		columns,
		backlogFilter,
		noteFilter: normalizeBoardNoteFilter(board.noteFilter),
		// Pre-sync boards did not have a version. Persist a one-time local version so they upload.
		updatedAt: Number(board.updatedAt) || Date.now(),
		...(Object.keys(fieldTimes).length ? { fieldTimes } : {}),
		...(Object.keys(fieldWriters).length ? { fieldWriters } : {})
	};
}

export function createKanbanBoard(name = 'Untitled board'): KanbanBoard {
	const now = Date.now();
	return {
		id: uid(),
		name: name.trim() || 'Untitled board',
		columns: [{ id: uid(), labelId: null, order: [] }],
		backlogFilter: defaultBacklogFilter(),
		noteFilter: defaultBoardNoteFilter(),
		updatedAt: now
	};
}

/** Label ids used by this board's non-backlog columns. */
export function boardColumnLabelIds(board: KanbanBoard): Set<string> {
	return new Set(
		board.columns.flatMap((candidate) => (candidate.labelId === null ? [] : [candidate.labelId]))
	);
}

/** The labels the board's note filter acts on: the selected ones that are not a column. */
export function noteFilterLabelIds(board: KanbanBoard): string[] {
	const columnLabels = boardColumnLabelIds(board);
	return board.noteFilter.labelIds.filter((labelId) => !columnLabels.has(labelId));
}

/** The notes the board's note filter lets onto the board at all. */
export function boardNotes(board: KanbanBoard, notes: Note[]): Note[] {
	const selected = new Set(noteFilterLabelIds(board));
	if (selected.size === 0) return notes;
	const keep = board.noteFilter.action === BoardNoteFilterAction.Keep;
	return notes.filter((note) => note.labels.some((labelId) => selected.has(labelId)) === keep);
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
 * Either way, only notes the board's note filter lets on.
 */
export function columnNotes(board: KanbanBoard, column: KanbanColumn, notes: Note[]): Note[] {
	const columnLabelId = column.labelId;
	const onBoard = boardNotes(board, notes);
	const members =
		columnLabelId !== null
			? onBoard.filter((note) => note.labels.includes(columnLabelId))
			: onBoard.filter((note) => noteMatchesBacklog(board, note));
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

/**
 * Where the drop preview belongs among a column's rendered items, given which
 * of them is the carried card and which slot on show the drop aims at.
 *
 * The carried card stays in the list while it is being dragged, hidden, so the
 * items and the slots the user can see no longer line up one to one. Counting
 * only the cards on show keeps the preview under the finger; counting the
 * hidden one as well leaves it a card behind, which on a column of tall cards
 * is most of a screen away from where the note would actually land.
 */
export function slotPosition(carried: boolean[], visibleIndex: number): number {
	let seen = 0;
	for (const [position, isCarried] of carried.entries()) {
		if (isCarried) continue;
		if (seen === visibleIndex) return position;
		seen += 1;
	}
	return carried.length;
}

function boardFieldTime(board: KanbanBoard, field: BoardField): number {
	return Number(board.fieldTimes?.[field]) || board.updatedAt;
}

/** The column set and sequence, without card order, which merges per column. */
function columnLayout(board: KanbanBoard): string {
	return stableStringify(board.columns.map(({ id, labelId }) => ({ id, labelId })));
}

/**
 * An empty order nobody arranged is no opinion: it never overwrites an
 * arrangement somebody made by hand, which is how a column would fall back to
 * feed order after a sync.
 */
function orderTime(column: KanbanColumn, board: KanbanBoard): number {
	return column.orderedAt ?? (column.order.length > 0 ? board.updatedAt : 0);
}

/**
 * Record an edit to a board: only settings whose value changes are stamped,
 * and a column's card order carries its own stamp, so edits to different parts
 * of one board on two devices both survive the merge.
 */
export function applyBoardEdit(
	previous: KanbanBoard,
	next: KanbanBoard,
	context: EditContext
): KanbanBoard {
	const at = context.now();
	// Untouched settings keep their current times rather than falling back to the bumped updatedAt.
	const fieldTimes: Partial<Record<BoardField, number>> = Object.fromEntries(
		BOARD_FIELDS.map((field) => [field, boardFieldTime(previous, field)])
	);
	const fieldWriters = { ...previous.fieldWriters };
	let changed = false;
	const stamp = (field: BoardField) => {
		fieldTimes[field] = Math.max(at, boardFieldTime(previous, field) + 1);
		fieldWriters[field] = context.writer;
		changed = true;
	};
	if (next.name !== previous.name) stamp('name');
	if (stableStringify(next.backlogFilter) !== stableStringify(previous.backlogFilter)) {
		stamp('backlogFilter');
	}
	if (stableStringify(next.noteFilter) !== stableStringify(previous.noteFilter)) {
		stamp('noteFilter');
	}
	if (columnLayout(next) !== columnLayout(previous)) stamp('columns');
	const before = new Map(previous.columns.map((column) => [column.id, column]));
	const columns = next.columns.map((column) => {
		const old = before.get(column.id);
		if (stableStringify(column.order) === stableStringify(old?.order ?? [])) return column;
		changed = true;
		return {
			...column,
			orderedAt: Math.max(at, (old ? orderTime(old, previous) : 0) + 1),
			orderWriter: context.writer
		};
	});
	if (!changed) return previous;
	return {
		...next,
		columns,
		updatedAt: Math.max(at, previous.updatedAt + 1, ...Object.values(fieldTimes)),
		fieldTimes,
		fieldWriters
	};
}

function side<T>(board: KanbanBoard, field: BoardField, value: T) {
	return { value, time: boardFieldTime(board, field), writer: board.fieldWriters?.[field] };
}

/** A column from the winning layout, with whichever copy's card order is newer. */
function mergeColumn(
	column: KanbanColumn,
	board: KanbanBoard,
	copy: KanbanColumn,
	copyBoard: KanbanBoard
): KanbanColumn {
	const arranged = pickLatest(
		{ value: column, time: orderTime(column, board), writer: column.orderWriter },
		{ value: copy, time: orderTime(copy, copyBoard), writer: copy.orderWriter }
	).value;
	return {
		id: column.id,
		labelId: column.labelId,
		order: [...arranged.order],
		...(arranged.orderedAt != null ? { orderedAt: arranged.orderedAt } : {}),
		...(arranged.orderWriter ? { orderWriter: arranged.orderWriter } : {})
	};
}

/** Each setting and each column's card order is last-write-wins on its own. */
export function mergeTwoBoards(left: KanbanBoard, right: KanbanBoard): KanbanBoard {
	if (left === right) return left;
	const name = pickLatest(side(left, 'name', left.name), side(right, 'name', right.name));
	const backlogFilter = pickLatest(
		side(left, 'backlogFilter', left.backlogFilter),
		side(right, 'backlogFilter', right.backlogFilter)
	);
	const noteFilter = pickLatest(
		side(left, 'noteFilter', left.noteFilter),
		side(right, 'noteFilter', right.noteFilter)
	);
	const layout = pickLatest(side(left, 'columns', left), side(right, 'columns', right));
	const other = layout.value === left ? right : left;
	const otherColumns = new Map(other.columns.map((column) => [column.id, column]));
	const columns = layout.value.columns.map((column) => {
		const copy = otherColumns.get(column.id);
		return copy ? mergeColumn(column, layout.value, copy, other) : column;
	});
	const picked = { name, backlogFilter, noteFilter, columns: layout };
	const fieldTimes: Partial<Record<BoardField, number>> = {};
	const fieldWriters: Partial<Record<BoardField, string>> = {};
	for (const field of BOARD_FIELDS) {
		fieldTimes[field] = picked[field].time;
		const writer = picked[field].writer;
		if (writer) fieldWriters[field] = writer;
	}
	return {
		id: left.id,
		name: name.value,
		columns,
		backlogFilter: backlogFilter.value,
		noteFilter: noteFilter.value,
		updatedAt: Math.max(left.updatedAt, right.updatedAt),
		fieldTimes,
		...(Object.keys(fieldWriters).length ? { fieldWriters } : {})
	};
}

export function mergeKanbanBoards(
	local: KanbanBoard[],
	remote: KanbanBoard[],
	tombstones: Record<string, number> = {}
): KanbanBoard[] {
	const byId = new Map(local.map((board) => [board.id, board]));
	for (const board of remote) {
		const current = byId.get(board.id);
		byId.set(board.id, current ? mergeTwoBoards(current, board) : board);
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
