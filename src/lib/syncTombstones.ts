// What a workspace has deleted, and its boards, as its database holds them. A
// permanent delete wins until cleared. Every write here goes on top of what is
// stored at that moment, for whichever workspace it names.
import { deleteLabelRecordingIt, getSyncState, mergeWorkspaceState } from '#lib/db/idb.js';

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

/** The later delete of each record in either map. */
export function newestTombstones(held: Tombstones, other: Tombstones): Tombstones {
	const merged = { ...held };
	for (const [id, deletedAt] of Object.entries(other)) {
		if (deletedAt > (merged[id] || 0)) merged[id] = deletedAt;
	}
	return merged;
}

/**
 * Record note deletes, with their upload markers, on top of the ones stored at that
 * moment: a delete a sync saved meanwhile is kept. Returns all of them.
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
	return state[NOTE_IDB];
}

/** Delete a label and record it; returns every label delete stored. */
export async function deleteLabelWithTombstone(
	pid: string,
	id: string,
	deletedAt: number,
	syncOutboxKeys: Iterable<string> = []
): Promise<Tombstones> {
	return sanitizeTombstones(
		await deleteLabelRecordingIt(pid, id, LABEL_IDB, deletedAt, syncOutboxKeys)
	);
}

type WorkspaceTombstones = { notes: Tombstones; labels: Tombstones; boards: Tombstones };

/** What a workspace has deleted, as its database holds it. */
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

/**
 * Save a workspace's boards and board deletes with their upload markers in one
 * transaction. `merge` makes them from what is stored at that moment, so boards a
 * sync saved meanwhile are kept.
 */
export async function writeKanbanState<T>(
	pid: string,
	boards: T[],
	boardTombstones: Tombstones,
	syncOutboxKeys: Iterable<string>,
	merge: (stored: unknown, mine: T[], deleted: Tombstones) => T[]
): Promise<void> {
	const mine = sanitizeTombstones(boardTombstones);
	const plain = JSON.parse(JSON.stringify(boards ?? [])) as T[];
	await mergeWorkspaceState(pid, [BOARDS_IDB, BOARD_IDB], (current) => {
		const deleted = newestTombstones(sanitizeTombstones(current[BOARD_IDB]), mine);
		return {
			value: { [BOARDS_IDB]: merge(current[BOARDS_IDB], plain, deleted), [BOARD_IDB]: deleted },
			outboxKeys: syncOutboxKeys
		};
	});
}
