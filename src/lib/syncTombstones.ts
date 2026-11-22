// Durable delete manifests in IndexedDB. Permanent delete wins until cleared.
import {
	deleteLabelRecordingIt,
	getSyncState,
	mergeWorkspaceState,
	setSyncState,
	writeSyncStateWithOutbox
} from '#lib/db/idb.js';

export const NOTE_IDB = 'scrapscache-idb-note-tombstones';
export const LABEL_IDB = 'scrapscache-idb-label-tombstones';
export const BOARD_IDB = 'scrapscache-idb-board-tombstones';
export const BOARDS_IDB = 'scrapscache-idb-kanban-boards';

export type Tombstones = Record<string, number>;

export function sanitizeTombstones(value: unknown): Tombstones {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).flatMap(([id, at]) =>
			typeof id === 'string' && Number(at) > 0 ? [[id, Number(at)]] : []
		)
	);
}

let noteCache: Tombstones | null = null;
let labelCache: Tombstones | null = null;
let boardCache: Tombstones | null = null;

export function resetTombstoneCaches(): void {
	noteCache = null;
	labelCache = null;
	boardCache = null;
}

/** A sync saved these deletions for the open workspace: the caches hold them from now on. */
export function adoptTombstones(notes: Tombstones, labels: Tombstones): void {
	noteCache = sanitizeTombstones(notes);
	labelCache = sanitizeTombstones(labels);
}

export function readTombstones(): Tombstones {
	return { ...(noteCache ?? {}) };
}

export function readLabelTombstones(): Tombstones {
	return { ...(labelCache ?? {}) };
}

export function readBoardTombstones(): Tombstones {
	return { ...(boardCache ?? {}) };
}

/** The later delete of each record in either map. */
export function newestTombstones(held: Tombstones, other: Tombstones): Tombstones {
	const merged = { ...held };
	for (const [id, deletedAt] of Object.entries(other)) {
		if (deletedAt > (merged[id] || 0)) merged[id] = deletedAt;
	}
	return merged;
}

/** Replace the open workspace's note deletes, for an operation that rewrites the workspace. */
export async function writeTombstones(pid: string, tombstones: Tombstones): Promise<void> {
	noteCache = sanitizeTombstones(tombstones);
	await setSyncState(pid, NOTE_IDB, noteCache);
}

/**
 * Record note deletes of the open workspace, with their upload markers, on top of
 * the ones stored at that moment: a delete a sync saved meanwhile is kept. Returns
 * all of them.
 */
export async function addTombstones(
	pid: string,
	added: Tombstones,
	syncOutboxKeys: Iterable<string> = []
): Promise<Tombstones> {
	const state = await mergeWorkspaceState(pid, [NOTE_IDB], (current) => ({
		value: { [NOTE_IDB]: newestTombstones(sanitizeTombstones(current[NOTE_IDB]), added) },
		outboxKeys: syncOutboxKeys
	}));
	noteCache = newestTombstones(noteCache ?? {}, state[NOTE_IDB]);
	return { ...noteCache };
}

/** Replace the open workspace's label deletes, for an operation that rewrites the workspace. */
export async function writeLabelTombstones(
	pid: string,
	tombstones: Tombstones,
	syncOutboxKeys: Iterable<string> = []
): Promise<void> {
	labelCache = sanitizeTombstones(tombstones);
	await writeSyncStateWithOutbox(pid, [[LABEL_IDB, labelCache]], syncOutboxKeys);
}

/** Delete a label of the open workspace and record it; returns every label delete stored. */
export async function deleteLabelWithTombstone(
	pid: string,
	id: string,
	deletedAt: number,
	syncOutboxKeys: Iterable<string> = []
): Promise<Tombstones> {
	const stored = sanitizeTombstones(
		await deleteLabelRecordingIt(pid, id, LABEL_IDB, deletedAt, syncOutboxKeys)
	);
	labelCache = newestTombstones(labelCache ?? {}, stored);
	return { ...labelCache };
}

type WorkspaceTombstones = { notes: Tombstones; labels: Tombstones; boards: Tombstones };

/** What a workspace has deleted, as its database holds it. The open workspace's caches stay as they are. */
export async function readStoredTombstones(pid: string): Promise<WorkspaceTombstones> {
	const [notes, labels, boards] = await Promise.all([
		getSyncState<unknown>(pid, NOTE_IDB),
		getSyncState<unknown>(pid, LABEL_IDB),
		getSyncState<unknown>(pid, BOARD_IDB)
	]);
	return {
		notes: sanitizeTombstones(notes),
		labels: sanitizeTombstones(labels),
		boards: sanitizeTombstones(boards)
	};
}

/** Load the open workspace's tombstones. */
export async function hydrateTombstones(pid: string): Promise<WorkspaceTombstones> {
	const stored = await readStoredTombstones(pid);
	noteCache = stored.notes;
	labelCache = stored.labels;
	boardCache = stored.boards;
	return { notes: { ...noteCache }, labels: { ...labelCache }, boards: { ...boardCache } };
}

/**
 * Boards a workspace saved on this device.
 *
 * The workspace is named outright rather than inferred from how many arguments
 * turned up: a caller whose fallback is `undefined` used to read as one with no
 * workspace at all, so a signed-in workspace silently read the anonymous one's
 * boards, found none, and started over with an empty board on every load.
 */
export async function loadBoardsFromDevice<T>(pid: string, fallback: T): Promise<T> {
	const stored = await getSyncState<T>(pid, BOARDS_IDB);
	return stored ?? fallback;
}

export async function saveBoardsToDevice<T>(pid: string, boards: T): Promise<void> {
	// `$state` board proxies throw DataCloneError in IndexedDB; JSON is already how
	// localStorage snapshots them.
	await setSyncState(pid, BOARDS_IDB, JSON.parse(JSON.stringify(boards ?? [])));
}

/**
 * Save the open workspace's boards and board deletes with their upload markers in
 * one transaction. With `merge` they go on top of what is stored at that moment,
 * so boards a sync saved meanwhile are kept; without it they replace what is stored.
 */
export async function writeKanbanState<T>(
	pid: string,
	boards: T[],
	boardTombstones: Tombstones,
	syncOutboxKeys: Iterable<string> = [],
	merge?: (stored: unknown, mine: T[], deleted: Tombstones) => T[]
): Promise<void> {
	const mine = sanitizeTombstones(boardTombstones);
	const plain = JSON.parse(JSON.stringify(boards ?? [])) as T[];
	if (!merge) {
		boardCache = mine;
		await writeSyncStateWithOutbox(
			pid,
			[
				[BOARDS_IDB, plain],
				[BOARD_IDB, boardCache]
			],
			syncOutboxKeys
		);
		return;
	}
	const state = await mergeWorkspaceState(pid, [BOARDS_IDB, BOARD_IDB], (current) => {
		const deleted = newestTombstones(sanitizeTombstones(current[BOARD_IDB]), mine);
		return {
			value: { [BOARDS_IDB]: merge(current[BOARDS_IDB], plain, deleted), [BOARD_IDB]: deleted },
			outboxKeys: syncOutboxKeys
		};
	});
	boardCache = newestTombstones(boardCache ?? {}, state[BOARD_IDB]);
}
