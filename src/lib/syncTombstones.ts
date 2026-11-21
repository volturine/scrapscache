// Durable delete manifests in IndexedDB. Permanent delete wins until cleared.
import {
	deleteLabelWithSyncState,
	getSyncState,
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

export function readTombstones(): Tombstones {
	return { ...(noteCache ?? {}) };
}

export function readLabelTombstones(): Tombstones {
	return { ...(labelCache ?? {}) };
}

export function readBoardTombstones(): Tombstones {
	return { ...(boardCache ?? {}) };
}

export async function writeTombstones(pid: string, tombstones: Tombstones): Promise<void> {
	noteCache = sanitizeTombstones(tombstones);
	await setSyncState(pid, NOTE_IDB, noteCache);
}

export async function writeLabelTombstones(
	pid: string,
	tombstones: Tombstones,
	syncOutboxKeys: Iterable<string> = []
): Promise<void> {
	labelCache = sanitizeTombstones(tombstones);
	await writeSyncStateWithOutbox(pid, [[LABEL_IDB, labelCache]], syncOutboxKeys);
}

export async function deleteLabelWithTombstone(
	pid: string,
	id: string,
	tombstones: Tombstones,
	syncOutboxKeys: Iterable<string> = []
): Promise<void> {
	const next = sanitizeTombstones(tombstones);
	await deleteLabelWithSyncState(pid, id, [[LABEL_IDB, next]], syncOutboxKeys);
	labelCache = next;
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

/** Persist boards, tombstones, and optional upload markers in one transaction. */
export async function writeKanbanState(
	pid: string,
	boards: unknown,
	boardTombstones: Tombstones,
	syncOutboxKeys: Iterable<string> = []
): Promise<void> {
	boardCache = sanitizeTombstones(boardTombstones);
	await writeSyncStateWithOutbox(
		pid,
		[
			[BOARDS_IDB, JSON.parse(JSON.stringify(boards ?? []))],
			[BOARD_IDB, boardCache]
		],
		syncOutboxKeys
	);
}
