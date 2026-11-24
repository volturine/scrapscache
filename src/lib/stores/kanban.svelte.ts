import {
	applyBoardEdit,
	createKanbanBoard,
	mergeKanbanBoards,
	normalizeBoardNoteFilter,
	normalizeBoards,
	type BoardNoteFilter,
	type KanbanBoard,
	type KanbanColumn
} from '#lib/kanban.js';
import { workspaceKey, writeMirror } from '#lib/localMirror.js';
import { recordKey } from '#lib/syncRecords.js';
import { syncStore } from '#lib/stores/sync.svelte.js';
import { loadBoardsFromDevice, sanitizeTombstones, writeKanbanState } from '#lib/syncTombstones.js';
import { uid } from '#lib/model/index.js';
import { editContext, syncClock } from '#lib/editContext.js';
import { actionUndo } from '#lib/stores/actionUndo.svelte.js';
import { dropNotesMirror } from '#lib/noteStorage.js';
import { PendingJournal, type Pending, type PendingChange } from '#lib/pendingJournal.js';
import { UnsavedChanges } from '#lib/unsavedChanges.js';
import { trackLocalWrites } from '#lib/localWrites.js';
import { syncScheduler } from '#lib/stores/syncScheduler.js';

/**
 * Fast-boot mirrors, one set per workspace, each key suffixed with the workspace
 * id — a shared key meant the last workspace to save its boards decided what the
 * next one showed on the way up.
 */
const BOARDS_KEY = 'scrapscache-kanban-boards-v1';
const ACTIVE_BOARD_KEY = 'scrapscache-kanban-active-board-v1';
const BOARD_TOMBSTONES_KEY = 'scrapscache-kanban-board-tombstones-v1';

/** Boards whose save has not landed: the board, or the time it was deleted. */
const pendingBoards = new PendingJournal<PendingChange<KanbanBoard>>(
	'scrapscache-boards-pending',
	dropNotesMirror
);

/**
 * Drop a workspace's board mirror and unsaved board changes, a save waiting to be
 * tried again included, so nothing of them outlives what replaced them.
 */
export function clearBoardsMirror(pid: string): void {
	kanbanStore.dropUnsaved(pid);
	if (typeof localStorage === 'undefined') return;
	for (const key of [BOARDS_KEY, ACTIVE_BOARD_KEY, BOARD_TOMBSTONES_KEY]) {
		localStorage.removeItem(workspaceKey(key, pid));
	}
}

/**
 * What this workspace last mirrored, which may be nothing at all. Making one up
 * here is the caller's business: a boot needs a board to show, while a merge
 * needs the truth, or an empty shelf would look like a board worth keeping.
 */
function readBoards(pid: string): KanbanBoard[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		return normalizeBoards(JSON.parse(localStorage.getItem(workspaceKey(BOARDS_KEY, pid)) || '[]'));
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
		return sanitizeTombstones(
			JSON.parse(localStorage.getItem(workspaceKey(BOARD_TOMBSTONES_KEY, pid)) || '{}')
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
	/** Saves that failed and wait to be tried again, by workspace, with the upload marks they owe. */
	private unsaved = new UnsavedChanges(pendingBoards, 'boards');
	/** The workspace whose boards this store holds: the one last loaded, not always the one shown. */
	private holding = syncStore.activePid;
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
			const storedId = localStorage.getItem(workspaceKey(ACTIVE_BOARD_KEY, syncStore.activePid));
			this.#activeBoardId = this.#boards.some((board) => board.id === storedId)
				? storedId!
				: this.#boards[0].id;
		} else {
			this.#activeBoardId = this.#boards[0].id;
		}
		this.#persistable = true;
	}

	/** The fast-boot mirror; IndexedDB holds the durable copy, so a full localStorage only skips it. */
	#persist() {
		const pid = syncStore.activePid;
		if (!this.#persistable || typeof localStorage === 'undefined' || !pid) return;
		writeMirror(workspaceKey(BOARDS_KEY, pid), JSON.stringify(this.#boards));
		writeMirror(workspaceKey(ACTIVE_BOARD_KEY, pid), this.#activeBoardId);
		writeMirror(workspaceKey(BOARD_TOMBSTONES_KEY, pid), JSON.stringify(this.#boardTombstones));
	}

	/**
	 * Load this workspace's boards. When the device store cannot be read (private
	 * modes, storage blocked) the mirror alone is shown, so the workspace is still
	 * usable, and the read error is rethrown once the state is in place so the
	 * caller can report it.
	 */
	async hydrateFromDevice(
		pid: string,
		remoteTombstones: Record<string, number> = {},
		/** False once the window has moved on to another workspace: nothing is loaded then. */
		wanted: () => boolean = () => true
	): Promise<void> {
		// Read this workspace's shelf before touching any state: saving state
		// mirrors whatever is in memory, which until the swap below still belongs
		// to the workspace being left.
		const mirroredBoards = readBoards(pid);
		const mirroredTombstones = readTombstones(pid);
		// Board changes whose save never landed: the board as changed, or when it was deleted.
		const unsaved = this.unsaved.read(pid);
		const unsavedBoards = normalizeBoards(
			Object.values(unsaved).flatMap((change) => (change.kind === 'put' ? [change.value] : []))
		);
		let stored: KanbanBoard[] | undefined;
		let deviceReadError: unknown = null;
		try {
			stored = await loadBoardsFromDevice<KanbanBoard[] | undefined>(pid, undefined);
		} catch (error) {
			deviceReadError = error;
		}
		// The window moved on while the device was read: these boards are not its own.
		if (!wanted()) return;
		// Normalized on read: boards stored before a field existed must not reach
		// the reactive state half-shaped.
		const fromIdb = normalizeBoards(stored);
		// Whatever is in memory belongs to the workspace being left, so a switch
		// reads the one being entered off its own shelf. Merging memory in would
		// carry the last workspace's boards — and its board deletions — across.
		// The shelf can outrun IndexedDB after a crash, so the newer of the two wins.
		const tombstones = { ...mirroredTombstones, ...remoteTombstones };
		const unsavedDeletes: string[] = [];
		for (const [id, change] of Object.entries(unsaved)) {
			if (change.kind !== 'delete') continue;
			if (change.at > (tombstones[id] || 0)) tombstones[id] = change.at;
			// Owed unless the database has it: the mirror having it says nothing of that.
			if (change.at > (remoteTombstones[id] || 0))
				unsavedDeletes.push(recordKey('board-tombstone', id));
		}
		this.holding = pid;
		this.boardTombstones = tombstones;
		this.boards = mergeKanbanBoards(
			mergeKanbanBoards(mirroredBoards, unsavedBoards, tombstones),
			fromIdb,
			tombstones
		);
		if (!this.boards.length) this.boards = [createKanbanBoard()];
		if (!this.boards.some((board) => board.id === this.activeBoardId))
			this.activeBoardId = this.boards[0].id;
		const idbById = new Map(fromIdb.map((board) => [board.id, board]));
		const recovered = this.boards.filter((board) => {
			const current = idbById.get(board.id);
			return !current || current.updatedAt < board.updatedAt;
		});
		// With no device copy to compare against, nothing is known to be missing there.
		if (deviceReadError === null) {
			// A board the journal names is saved whatever its time says: boards merge part
			// by part, so one that looks no newer than the stored one may still carry a
			// change the database has not got.
			const keys = new Set([
				...recovered.map((board) => recordKey('board', board.id)),
				...unsavedBoards
					.filter((board) => this.boards.some((candidate) => candidate.id === board.id))
					.map((board) => recordKey('board', board.id)),
				...unsavedDeletes
			]);
			// Once that has landed, what the journal held when this load read it is saved,
			// or lost to something newer. With nothing to save, it is that already.
			if (keys.size) void this.requestSync(keys, unsaved);
			else this.unsaved.settle(pid, unsaved);
		}
		await this.pendingDeviceWrites;
		if (deviceReadError !== null) throw deviceReadError;
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
			},
			noteFilter: { ...board.noteFilter, labelIds: [...board.noteFilter.labelIds] }
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
	 * Save the boards as they are now, in the order asked. They go on top of what is
	 * stored at that moment, so boards a sync saved meanwhile are kept.
	 */
	private save(
		pid: string,
		outboxKeys: string[],
		/** What a start read from the journal and saves again: it is journaled already. */
		replayed?: Pending<PendingChange<KanbanBoard>>
	): Promise<void> {
		const boards = this.boardsForSync();
		const tombstones = this.boardTombstonesForSync();
		// A replay journals nothing: another window may have journaled something newer since.
		const changes =
			replayed ??
			this.unsaved.journalFor(pid, outboxKeys, (id): PendingChange<KanbanBoard> | undefined => {
				// A board that is here was put back after its delete, so it is the newer of the two.
				const board = boards.find((candidate) => candidate.id === id);
				if (board) return { kind: 'put', value: board };
				return tombstones[id] ? { kind: 'delete', at: tombstones[id] } : undefined;
			});
		const write = this.pendingDeviceWrites
			.then(() =>
				writeKanbanState(pid, boards, tombstones, outboxKeys, (stored, mine, deleted) =>
					mergeKanbanBoards(normalizeBoards(stored), mine, deleted)
				)
			)
			.then(() => this.unsaved.settle(pid, changes));
		this.pendingDeviceWrites = write.catch(() => undefined);
		return write;
	}

	selectBoard(id: string): void {
		if (this.boards.some((board) => board.id === id)) this.activeBoardId = id;
	}

	createBoard(name = 'Untitled board'): KanbanBoard {
		const board = createKanbanBoard(name);
		this.boards = [...this.boards, board];
		this.activeBoardId = board.id;
		this.requestSync([recordKey('board', board.id)]);
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
	 * untitled board is created so the Kanban view stays usable. Undo puts it back.
	 */
	deleteBoard(boardId: string): void {
		const index = this.boards.findIndex((board) => board.id === boardId);
		if (index === -1) return;
		const board = $state.snapshot(this.boards[index]) as KanbanBoard;
		const wasActive = this.activeBoardId === boardId;
		let standIn = this.removeBoard(boardId);
		actionUndo.push({
			message: 'Board deleted',
			noteIds: [],
			undo: () => {
				this.restoreBoard(board, index, wasActive);
				if (standIn) this.removeBoard(standIn);
			},
			redo: () => {
				standIn = this.removeBoard(boardId);
			}
		});
	}

	/** Returns the untitled board created when the last one goes, if any. */
	private removeBoard(boardId: string): string | null {
		const existing = this.boards.find((board) => board.id === boardId);
		if (!existing) return null;

		const deletedAt = this.nextVersion(existing.updatedAt);
		this.boardTombstones = { ...this.boardTombstones, [boardId]: deletedAt };
		const remaining = this.boards.filter((board) => board.id !== boardId);
		const syncKeys = [recordKey('board-tombstone', boardId)];
		let replacement: KanbanBoard | null = null;

		if (remaining.length === 0) {
			replacement = createKanbanBoard();
			this.boards = [replacement];
			this.activeBoardId = replacement.id;
			syncKeys.push(recordKey('board', replacement.id));
		} else {
			this.boards = remaining;
			if (this.activeBoardId === boardId) this.activeBoardId = remaining[0].id;
		}

		this.requestSync(syncKeys);
		return replacement?.id ?? null;
	}

	/** A board comes back newer than its tombstone, so a sync that has the delete keeps it. */
	private restoreBoard(board: KanbanBoard, index: number, select: boolean): void {
		if (this.boards.some((candidate) => candidate.id === board.id)) return;
		const buried = Number(this.boardTombstones[board.id]) || 0;
		const restored = {
			...board,
			updatedAt: Math.max(this.nextVersion(board.updatedAt), buried + 1)
		};
		this.boards = [...this.boards.slice(0, index), restored, ...this.boards.slice(index)];
		if (select) this.activeBoardId = board.id;
		this.requestSync([recordKey('board', board.id)]);
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

	/** Shift a label column one place left or right; the Unsorted column stays first. */
	moveColumn(boardId: string, columnId: string, direction: -1 | 1): void {
		const board = this.boards.find((candidate) => candidate.id === boardId);
		if (!board) return;
		const from = board.columns.findIndex((column) => column.id === columnId);
		const to = from + direction;
		if (from < 0 || board.columns[from].labelId === null) return;
		if (to < 0 || to >= board.columns.length || board.columns[to].labelId === null) return;
		this.changeBoard(boardId, (candidate) => {
			const columns = [...candidate.columns];
			[columns[from], columns[to]] = [columns[to], columns[from]];
			return { ...candidate, columns };
		});
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

	/** Replace which notes a board shows. */
	setNoteFilter(boardId: string, filter: BoardNoteFilter): void {
		const noteFilter = normalizeBoardNoteFilter(filter);
		this.changeBoard(boardId, (board) => ({ ...board, noteFilter }));
	}

	/** Monotonic version: same-millisecond edits and backward clock jumps must still win. */
	private nextVersion(previous: number | undefined): number {
		return Math.max(syncClock.now(), (previous ?? 0) + 1);
	}

	/** Board edits stamp only what they change, so each part of a board merges on its own. */
	private changeBoard(boardId: string, change: (board: KanbanBoard) => KanbanBoard): void {
		let changed = false;
		this.boards = this.boards.map((board) => {
			if (board.id !== boardId) return board;
			const edited = applyBoardEdit(board, change(board), editContext);
			changed = edited !== board;
			return edited;
		});
		if (changed) this.requestSync([recordKey('board', boardId)]);
	}

	/**
	 * Save the boards with the upload marks for `keys`. A save that failed is tried
	 * again, later each time, with every mark the failed ones owed, for as long as
	 * this store holds that workspace's boards and the window shows it. Whichever
	 * workspace is shown, the journal has the change for the next start.
	 */
	private requestSync(
		keys: Iterable<string> = [],
		replayed?: Pending<PendingChange<KanbanBoard>>
	): Promise<boolean> {
		const pid = syncStore.activePid;
		const marks = this.unsaved.begin(pid, keys);
		const saved = this.save(pid, marks, replayed).then(
			() => {
				this.unsaved.succeeded(pid);
				return true;
			},
			(err) => {
				console.error('[kanban] could not save the boards:', err);
				this.unsaved.failed(pid, marks, () => {
					// Between a switch and its load the store still holds the boards of the
					// workspace being left: those are never saved into another one.
					if (pid === syncStore.activePid && pid === this.holding) void this.requestSync();
					else this.unsaved.forget(pid);
				});
				return false;
			}
		);
		// The save queues the keys itself, in its own transaction: this only says so.
		syncScheduler.changed(pid);
		return saved;
	}

	/** No save of this workspace's boards waits to be tried again. The journal keeps what it has. */
	forgetUnsaved(pid: string): void {
		this.unsaved.forget(pid);
	}

	/** Nothing unsaved of this workspace's boards is kept: what replaced them stands. */
	dropUnsaved(pid: string): void {
		this.unsaved.clear(pid);
	}

	waitForPendingWrites(): Promise<void> {
		return this.pendingDeviceWrites;
	}
}

export const kanbanStore = new KanbanStore();
trackLocalWrites(() => kanbanStore.waitForPendingWrites());
