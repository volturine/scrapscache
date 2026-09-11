// Durable delete manifests in IndexedDB. Permanent delete wins until cleared.
import {
	deleteLabelWithSyncState,
	getSyncState,
	LOCAL_PROFILE_ID,
	scopedStateKey,
	setSyncState,
	writeSyncStateWithOutbox
} from '$lib/db/idb';

export const NOTE_IDB = 'scrapscache-idb-note-tombstones';
export const LABEL_IDB = 'scrapscache-idb-label-tombstones';
export const BOARD_IDB = 'scrapscache-idb-board-tombstones';
export const BOARDS_IDB = 'scrapscache-idb-kanban-boards';

export type Tombstones = Record<string, number>;

function sanitize(value: unknown): Tombstones {
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

export async function writeTombstones(
	pidOrTombstones: string | Tombstones,
	maybeTombstones?: Tombstones
): Promise<void> {
	const isScoped = typeof pidOrTombstones === 'string';
	const pid = isScoped ? pidOrTombstones : LOCAL_PROFILE_ID;
	const tombstones = isScoped ? (maybeTombstones as Tombstones) : pidOrTombstones;
	noteCache = sanitize(tombstones);
	await setSyncState(scopedStateKey(NOTE_IDB, pid), noteCache);
}

export async function writeLabelTombstones(
	pidOrTombstones: string | Tombstones,
	tombstonesOrKeys?: Tombstones | Iterable<string>,
	maybeKeys?: Iterable<string>
): Promise<void> {
	const isScoped = typeof pidOrTombstones === 'string';
	const pid = isScoped ? pidOrTombstones : LOCAL_PROFILE_ID;
	const tombstones = isScoped ? (tombstonesOrKeys as Tombstones) : (pidOrTombstones as Tombstones);
	const syncOutboxKeys = isScoped
		? (maybeKeys ?? [])
		: ((tombstonesOrKeys as Iterable<string>) ?? []);
	labelCache = sanitize(tombstones);
	await writeSyncStateWithOutbox(pid, [[LABEL_IDB, labelCache]], syncOutboxKeys);
}

export async function deleteLabelWithTombstone(
	pidOrId: string,
	idOrTombstones: string | Tombstones,
	tombstonesOrKeys?: Tombstones | Iterable<string>,
	maybeKeys?: Iterable<string>
): Promise<void> {
	const isScoped = typeof idOrTombstones === 'string';
	const pid = isScoped ? pidOrId : LOCAL_PROFILE_ID;
	const id = isScoped ? idOrTombstones : pidOrId;
	const tombstones = isScoped ? (tombstonesOrKeys as Tombstones) : (idOrTombstones as Tombstones);
	const syncOutboxKeys = isScoped
		? (maybeKeys ?? [])
		: ((tombstonesOrKeys as Iterable<string>) ?? []);
	const next = sanitize(tombstones);
	await deleteLabelWithSyncState(pid, id, [[LABEL_IDB, next]], syncOutboxKeys);
	labelCache = next;
}

export async function hydrateTombstones(pid: string = LOCAL_PROFILE_ID): Promise<{
	notes: Tombstones;
	labels: Tombstones;
	boards: Tombstones;
}> {
	const [idbNotes, idbLabels, idbBoards] = await Promise.all([
		getSyncState<unknown>(scopedStateKey(NOTE_IDB, pid)),
		getSyncState<unknown>(scopedStateKey(LABEL_IDB, pid)),
		getSyncState<unknown>(scopedStateKey(BOARD_IDB, pid))
	]);
	noteCache = sanitize(idbNotes);
	labelCache = sanitize(idbLabels);
	boardCache = sanitize(idbBoards);
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
	const stored = await getSyncState<T>(scopedStateKey(BOARDS_IDB, pid));
	return stored ?? fallback;
}

export async function saveBoardsToDevice<T>(pid: string, boards: T): Promise<void> {
	// `$state` board proxies throw DataCloneError in IndexedDB; JSON is already how
	// localStorage snapshots them.
	await setSyncState(scopedStateKey(BOARDS_IDB, pid), JSON.parse(JSON.stringify(boards ?? [])));
}

/** Persist boards, tombstones, and optional upload markers in one transaction. */
export async function writeKanbanState(
	pidOrBoards: string | unknown,
	boardsOrTombstones: unknown,
	tombstonesOrKeys?: Tombstones | Iterable<string>,
	maybeKeys?: Iterable<string>
): Promise<void> {
	const isScoped = typeof pidOrBoards === 'string';
	const pid = isScoped ? pidOrBoards : LOCAL_PROFILE_ID;
	const boards = isScoped ? boardsOrTombstones : pidOrBoards;
	const boardTombstones = isScoped
		? (tombstonesOrKeys as Tombstones)
		: (boardsOrTombstones as Tombstones);
	const syncOutboxKeys = isScoped
		? (maybeKeys ?? [])
		: ((tombstonesOrKeys as Iterable<string>) ?? []);

	boardCache = sanitize(boardTombstones);
	await writeSyncStateWithOutbox(
		pid,
		[
			[BOARDS_IDB, JSON.parse(JSON.stringify(boards ?? []))],
			[BOARD_IDB, boardCache]
		],
		syncOutboxKeys
	);
}
