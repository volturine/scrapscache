import {
	createKanbanBoard,
	mergeKanbanBoards,
	normalizeBacklogFilter,
	type BacklogFilter,
	type KanbanBoard,
	type KanbanColumn
} from '$lib/kanban';
import { LOCAL_PROFILE_ID, scopedStateKey } from '$lib/db/idb';
import { syncStore } from '$lib/stores/sync.svelte';
import { loadBoardsFromDevice, writeKanbanState } from '$lib/syncTombstones';
import { uid } from '$lib/utils';

/**
 * Fast-boot mirrors, one set per workspace. Anonymous keeps the bare keys, as
 * IndexedDB does, so every other workspace lands beside it rather than on top
 * of it — a shared key meant the last workspace to save its boards decided
 * what the next one showed on the way up.
 */
const BOARDS_KEY = 'scrapscache-kanban-boards-v1';
const ACTIVE_BOARD_KEY = 'scrapscache-kanban-active-board-v1';
const BOARD_TOMBSTONES_KEY = 'scrapscache-kanban-board-tombstones-v1';

type StoredBoard = {
	id?: unknown;
	name?: unknown;
	columns?: unknown;
	backlogFilter?: unknown;
	updatedAt?: unknown;
};

function normalizeBoard(value: unknown): KanbanBoard | null {
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
		const candidate = column as { id?: unknown; labelId?: unknown; order?: unknown };
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
		return [{ id: candidate.id, labelId, order }];
	});
	if (!hasBacklog) columns.unshift({ id: uid(), labelId: null, order: [] });
	const backlogFilter = normalizeBacklogFilter(board.backlogFilter);
	// A tag cannot be both a column and a backlog filter tag.
	backlogFilter.labelIds = backlogFilter.labelIds.filter((labelId) => !usedLabels.has(labelId));
	return {
		id: board.id,
		name: board.name.trim() || 'Untitled board',
		columns,
		backlogFilter,
		// Pre-sync boards did not have a version. Persist a one-time local version so they upload.
		updatedAt: Number(board.updatedAt) || Date.now()
	};
}

function normalizeBoards(value: unknown): KanbanBoard[] {
	return Array.isArray(value)
		? value.flatMap((board): KanbanBoard[] => {
				const normalized = normalizeBoard(board);
				return normalized ? [normalized] : [];
			})
		: [];
}

/**
 * What this workspace last mirrored, which may be nothing at all. Making one up
 * here is the caller's business: a boot needs a board to show, while a merge
 * needs the truth, or an empty shelf would look like a board worth keeping.
 */
function readBoards(pid: string): KanbanBoard[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		return normalizeBoards(
			JSON.parse(localStorage.getItem(scopedStateKey(BOARDS_KEY, pid)) || '[]')
		);
	} catch {
		return [];
	}
}

function boardsOrFresh(boards: KanbanBoard[]): KanbanBoard[] {
	return boards.length ? boards : [createKanbanBoard()];
}

function readTombstones(pid: string): Record<string, number> {
	if (typeof localStorage === 'undefined') return {};
	try {
		const value: unknown = JSON.parse(
			localStorage.getItem(scopedStateKey(BOARD_TOMBSTONES_KEY, pid)) || '{}'
		);
		if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
		return Object.fromEntries(
			Object.entries(value).flatMap(([id, updatedAt]) =>
				typeof id === 'string' && Number(updatedAt) > 0 ? [[id, Number(updatedAt)]] : []
			)
		);
	} catch {
		return {};
	}
}

export class KanbanStore {
	#boards = $state<KanbanBoard[]>(boardsOrFresh(readBoards(syncStore.activePid)));
	#activeBoardId = $state<string>('');
	#boardTombstones = $state<Record<string, number>>(readTombstones(syncStore.activePid));
	private pendingDeviceWrites: Promise<void> = Promise.resolve();
	#persistable = false;

	get boards() {
		return this.#boards;
	}
	set boards(value: KanbanBoard[]) {
		this.#boards = value;
		this.#persist();
	}

	get activeBoardId() {
		return this.#activeBoardId;
	}
	set activeBoardId(value: string) {
		this.#activeBoardId = value;
		this.#persist();
	}

	get boardTombstones() {
		return this.#boardTombstones;
	}
	set boardTombstones(value: Record<string, number>) {
		this.#boardTombstones = value;
		this.#persist();
	}

	constructor() {
		if (typeof localStorage !== 'undefined') {
			const storedId = localStorage.getItem(scopedStateKey(ACTIVE_BOARD_KEY, syncStore.activePid));
			this.#activeBoardId = this.#boards.some((board) => board.id === storedId)
				? storedId!
				: this.#boards[0].id;
		} else {
			this.#activeBoardId = this.#boards[0].id;
		}
		this.#persistable = true;
	}

	#persist() {
		if (!this.#persistable || typeof localStorage === 'undefined') return;
		const pid = syncStore.activePid;
		localStorage.setItem(scopedStateKey(BOARDS_KEY, pid), JSON.stringify(this.#boards));
		localStorage.setItem(scopedStateKey(ACTIVE_BOARD_KEY, pid), this.#activeBoardId);
		localStorage.setItem(
			scopedStateKey(BOARD_TOMBSTONES_KEY, pid),
			JSON.stringify(this.#boardTombstones)
		);
	}

	async hydrateFromDevice(
		pid: string,
		remoteTombstones: Record<string, number> = {}
	): Promise<void> {
		const isScoped = pid !== LOCAL_PROFILE_ID;
		// Read this workspace's shelf before touching any state: saving state
		// mirrors whatever is in memory, which until the swap below still belongs
		// to the workspace being left.
		const mirroredBoards = readBoards(pid);
		const mirroredTombstones = readTombstones(pid);
		const stored = await loadBoardsFromDevice<KanbanBoard[] | undefined>(pid, undefined);
		// Normalized on read: boards stored before a field existed must not reach
		// the reactive state half-shaped.
		const fromIdb = normalizeBoards(stored);
		// Whatever is in memory belongs to the workspace being left, so a switch
		// reads the one being entered off its own shelf. Merging memory in would
		// carry the last workspace's boards — and its board deletions — across.
		const tombstones = { ...(isScoped ? {} : mirroredTombstones), ...remoteTombstones };
		this.boardTombstones = tombstones;
		if (isScoped) {
			this.boards = fromIdb.length > 0 ? fromIdb : [createKanbanBoard()];
		} else {
			// The anonymous workspace keeps a localStorage mirror that can outrun
			// IndexedDB after a crash, so the newer of the two wins.
			this.boards = mergeKanbanBoards(mirroredBoards, fromIdb, tombstones);
			if (!this.boards.length) this.boards = [createKanbanBoard()];
		}
		if (!this.boards.some((board) => board.id === this.activeBoardId))
			this.activeBoardId = this.boards[0].id;
		const idbById = new Map(fromIdb.map((board) => [board.id, board]));
		const recovered = this.boards.filter((board) => {
			const current = idbById.get(board.id);
			return !current || current.updatedAt < board.updatedAt;
		});
		if (recovered.length && !isScoped) {
			this.requestSync(recovered.map((board) => `board:${board.id}`));
		}
		await this.pendingDeviceWrites;
	}

	get activeBoard(): KanbanBoard {
		return this.boards.find((board) => board.id === this.activeBoardId) ?? this.boards[0];
	}

	boardsForSync(): KanbanBoard[] {
		return this.boards.map((board) => ({
			...board,
			columns: board.columns.map((column) => ({ ...column, order: [...column.order] })),
			backlogFilter: {
				...board.backlogFilter,
				labelIds: [...board.backlogFilter.labelIds]
			}
		}));
	}

	boardTombstonesForSync(): Record<string, number> {
		return { ...this.boardTombstones };
	}

	/** Merge delta results without scheduling another upload. */
	applySync(remoteBoards: KanbanBoard[], remoteTombstones: Record<string, number> = {}): void {
		const tombstones = { ...this.boardTombstones };
		for (const [id, deletedAt] of Object.entries(remoteTombstones)) {
			if (Number(deletedAt) > (tombstones[id] || 0)) tombstones[id] = Number(deletedAt);
		}
		const remote = normalizeBoards(remoteBoards);
		const merged = mergeKanbanBoards(this.boards, remote, tombstones);
		this.boardTombstones = tombstones;
		this.boards = merged.length ? merged : [createKanbanBoard()];
		if (!this.boards.some((board) => board.id === this.activeBoardId))
			this.activeBoardId = this.boards[0].id;
	}

	/**
	 * The workspace is named rather than guessed: a single outbox key is a string
	 * too, so a signature that took either would sooner or later save one
	 * workspace's boards into another's.
	 */
	async persistSyncState(pid: string, syncOutboxKeys: Iterable<string> = []): Promise<void> {
		await writeKanbanState(
			pid,
			this.boardsForSync(),
			this.boardTombstonesForSync(),
			syncOutboxKeys
		);
	}

	/** Used for the explicit “discard local data” link flow. */
	replaceWithCloud(
		remoteBoards: KanbanBoard[],
		remoteTombstones: Record<string, number> = {}
	): void {
		this.boardTombstones = { ...remoteTombstones };
		const boards = normalizeBoards(remoteBoards).filter(
			(board) => (this.boardTombstones[board.id] || 0) < board.updatedAt
		);
		this.boards = boards.length ? boards : [createKanbanBoard()];
		if (!this.boards.some((board) => board.id === this.activeBoardId))
			this.activeBoardId = this.boards[0].id;
	}

	selectBoard(id: string): void {
		if (this.boards.some((board) => board.id === id)) this.activeBoardId = id;
	}

	createBoard(name = 'Untitled board'): KanbanBoard {
		const board = createKanbanBoard(name);
		this.boards = [...this.boards, board];
		this.activeBoardId = board.id;
		this.requestSync([`board:${board.id}`]);
		return board;
	}

	renameBoard(boardId: string, name: string): void {
		const nextName = name.trim();
		if (!nextName) return;
		this.changeBoard(boardId, (board) => ({ ...board, name: nextName }));
	}

	/**
	 * Delete a board locally and sync a tombstone so other devices drop it too.
	 * Always leaves at least one board: if the last board is removed, a fresh
	 * untitled board is created so the Kanban view stays usable.
	 */
	deleteBoard(boardId: string): void {
		const existing = this.boards.find((board) => board.id === boardId);
		if (!existing) return;

		const deletedAt = this.nextVersion(existing.updatedAt);
		this.boardTombstones = { ...this.boardTombstones, [boardId]: deletedAt };
		const remaining = this.boards.filter((board) => board.id !== boardId);
		const syncKeys = [`board-tombstone:${boardId}`];

		if (remaining.length === 0) {
			const replacement = createKanbanBoard();
			this.boards = [replacement];
			this.activeBoardId = replacement.id;
			syncKeys.push(`board:${replacement.id}`);
		} else {
			this.boards = remaining;
			if (this.activeBoardId === boardId) this.activeBoardId = remaining[0].id;
		}

		this.requestSync(syncKeys);
	}

	addTagColumn(boardId: string, labelId: string): KanbanColumn | null {
		const board = this.boards.find((candidate) => candidate.id === boardId);
		if (!board || !labelId || board.columns.some((column) => column.labelId === labelId))
			return null;
		const column: KanbanColumn = { id: uid(), labelId, order: [] };
		this.changeBoard(boardId, (candidate) => ({
			...candidate,
			columns: [...candidate.columns, column],
			// A column tag leaves the backlog filter (it lives in its own column).
			backlogFilter: {
				...candidate.backlogFilter,
				labelIds: candidate.backlogFilter.labelIds.filter((id) => id !== labelId)
			}
		}));
		return column;
	}

	removeTagColumn(boardId: string, columnId: string): void {
		const board = this.boards.find((candidate) => candidate.id === boardId);
		const column = board?.columns.find((candidate) => candidate.id === columnId);
		if (!board || !column || column.labelId === null) return;
		this.changeBoard(boardId, (candidate) => ({
			...candidate,
			columns: candidate.columns.filter((item) => item.id !== columnId)
		}));
	}

	/**
	 * Record where a dragged card landed: the destination column keeps the full
	 * new order, and the source column forgets the card so a later return to it
	 * is not pinned to a stale slot.
	 */
	placeCard(
		boardId: string,
		noteId: string,
		sourceColumnId: string,
		destinationColumnId: string,
		order: string[]
	): void {
		this.changeBoard(boardId, (board) => ({
			...board,
			columns: board.columns.map((column) => {
				if (column.id === destinationColumnId) return { ...column, order };
				if (column.id === sourceColumnId)
					return { ...column, order: column.order.filter((id) => id !== noteId) };
				return column;
			})
		}));
	}

	/** Replace the backlog membership rules for a board. */
	setBacklogFilter(boardId: string, filter: BacklogFilter): void {
		const board = this.boards.find((candidate) => candidate.id === boardId);
		if (!board) return;
		const columnLabels = new Set(
			board.columns.flatMap((column) => (column.labelId === null ? [] : [column.labelId]))
		);
		const next = normalizeBacklogFilter(filter);
		next.labelIds = next.labelIds.filter((labelId) => !columnLabels.has(labelId));
		this.changeBoard(boardId, (candidate) => ({ ...candidate, backlogFilter: next }));
	}

	/** Monotonic version: same-millisecond edits and backward clock jumps must still win. */
	private nextVersion(previous: number | undefined): number {
		return Math.max(Date.now(), (previous ?? 0) + 1);
	}

	private changeBoard(
		boardId: string,
		change: (
			board: KanbanBoard
		) => Omit<KanbanBoard, 'updatedAt'> & Partial<Pick<KanbanBoard, 'updatedAt'>>
	): void {
		let changed = false;
		const previous = this.boards.find((board) => board.id === boardId);
		const updatedAt = this.nextVersion(previous?.updatedAt);
		this.boards = this.boards.map((board) => {
			if (board.id !== boardId) return board;
			changed = true;
			return { ...change(board), updatedAt };
		});
		if (changed) this.requestSync([`board:${boardId}`]);
	}

	private requestSync(keys: Iterable<string> = []): void {
		const pid = syncStore.activePid;
		const boards = this.boardsForSync();
		const tombstones = this.boardTombstonesForSync();
		const outboxKeys = [...keys];
		const write = this.pendingDeviceWrites.then(() =>
			writeKanbanState(pid, boards, tombstones, outboxKeys)
		);
		this.pendingDeviceWrites = write.catch(() => undefined);
		// Empty re-mark: the atomic write above already queued the keys; this
		// only nudges the debounced push via the shared data-change hook.
		syncStore.requestAutoSync([]);
	}

	waitForPendingWrites(): Promise<void> {
		return this.pendingDeviceWrites;
	}
}

export const kanbanStore = new KanbanStore();
