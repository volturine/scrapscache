// What a backup or a Google Keep import writes into a workspace. Each plan is
// decided from what the workspace holds at the moment it lands, and lands whole:
// see `rewriteWorkspace`. Nothing here touches the in-memory stores, so an import
// lands in the workspace it was started for whether or not that one is still open.
import type { Label, Note } from '#lib/types.js';
import type { StoredWorkspace, WorkspaceRewrite } from '#lib/db/idb.js';
import { BackupImportMode, type ScrapsCacheBackup } from '#lib/backup.js';
import {
	CANVAS_LIBRARY_STATE_KEY,
	CANVAS_LIBRARY_TOMBSTONES_KEY,
	isCanvasLibraryEntry,
	restoredCanvasLibrary,
	sanitizeLibraryTombstones
} from '#lib/canvasLibrary.js';
import { normalizeBoard, type KanbanBoard } from '#lib/kanban.js';
import { uid } from '#lib/model/index.js';
import { noteRecordKeys, syncControlKeys } from '#lib/syncEngine.js';
import {
	BOARD_IDB,
	BOARDS_IDB,
	LABEL_IDB,
	NOTE_IDB,
	sanitizeTombstones
} from '#lib/syncTombstones.js';

/** What an import writes, decided when it lands, and the workspace state it reads to decide. */
export type ImportPlan = {
	notes: Note[];
	stateKeys: string[];
	land: (stored: StoredWorkspace) => WorkspaceRewrite;
};

/**
 * Labels an import adds: one the workspace already has by name is used as it is,
 * and the notes are moved onto the ids the workspace ends up with.
 */
function addLabels(
	stored: Label[],
	incoming: Label[],
	notes: Note[],
	now: number
): { labels: Label[]; notes: Note[] } {
	const byName = new Map(stored.map((label) => [label.name.trim().toLowerCase(), label]));
	const ids = new Map<string, string>();
	const added: Label[] = [];
	for (const label of incoming) {
		const name = label.name.trim().toLowerCase();
		const existing = byName.get(name);
		if (existing) {
			ids.set(label.id, existing.id);
			continue;
		}
		const imported = { ...label, id: uid(), createdAt: now, updatedAt: now };
		ids.set(label.id, imported.id);
		byName.set(name, imported);
		added.push(imported);
	}
	return {
		labels: added,
		notes: notes.map((note) => ({
			...note,
			labels: note.labels.flatMap((id) => {
				const mapped = ids.get(id);
				return mapped ? [mapped] : [];
			})
		}))
	};
}

function tombstoneKeys(kind: string, tombstones: Record<string, number>): string[] {
	return Object.keys(tombstones).map((id) => `${kind}-tombstone:${id}`);
}

function restoredLibrary(
	stored: StoredWorkspace,
	backup: ScrapsCacheBackup,
	replace: boolean,
	now: number
) {
	const entries = stored.state[CANVAS_LIBRARY_STATE_KEY];
	return restoredCanvasLibrary(
		{
			entries: Array.isArray(entries) ? entries.filter(isCanvasLibraryEntry) : [],
			tombstones: sanitizeLibraryTombstones(stored.state[CANVAS_LIBRARY_TOMBSTONES_KEY])
		},
		backup.canvasLibrary,
		replace,
		now
	);
}

/**
 * A full backup. `notes` are the backup's notes under the ids this import gives
 * them, in the backup's order. Adding keeps everything the workspace holds;
 * replacing leaves only the backup, and deletes every note it replaces, on every
 * device, so the relay is sent this device's whole copy again.
 */
export function planBackupImport(input: {
	backup: ScrapsCacheBackup;
	notes: Note[];
	mode: BackupImportMode;
	now: number;
	/** The relay account the workspace syncs with, when it syncs. */
	accountId: string | null;
}): ImportPlan {
	const { backup, notes, mode, now, accountId } = input;
	const library = [CANVAS_LIBRARY_STATE_KEY, CANVAS_LIBRARY_TOMBSTONES_KEY];
	if (mode === BackupImportMode.Keep) {
		return {
			notes,
			stateKeys: library,
			land: (stored) => {
				const added = addLabels(stored.labels, backup.labels, notes, now);
				const restored = restoredLibrary(stored, backup, false, now);
				return {
					clear: false,
					notes: added.notes,
					labels: added.labels,
					state: {
						[CANVAS_LIBRARY_STATE_KEY]: restored.entries,
						[CANVAS_LIBRARY_TOMBSTONES_KEY]: restored.tombstones
					},
					outboxKeys: [
						...added.notes.flatMap(noteRecordKeys),
						...added.labels.map((label) => `label:${label.id}`),
						...restored.keys
					]
				};
			}
		};
	}
	const importedIds = new Map(backup.notes.map((note, index) => [note.id, notes[index].id]));
	const control = accountId ? syncControlKeys(accountId) : null;
	return {
		notes,
		stateKeys: [NOTE_IDB, ...library],
		land: (stored) => {
			// The notes return under new ids, so every copy under an old id goes.
			const tombstones = {
				...sanitizeTombstones(stored.state[NOTE_IDB]),
				...sanitizeTombstones(backup.tombstones)
			};
			for (const id of [...stored.noteIds, ...importedIds.keys()]) tombstones[id] = now;
			const labelTombstones = sanitizeTombstones(backup.labelTombstones);
			const boardTombstones = sanitizeTombstones(backup.boardTombstones);
			const boards = backup.boards.flatMap((board): KanbanBoard[] => {
				const normalized = normalizeBoard({
					...board,
					columns: board.columns.map((column) => ({
						...column,
						order: column.order.flatMap((id) => {
							const imported = importedIds.get(id);
							return imported ? [imported] : [];
						})
					}))
				});
				return normalized && (boardTombstones[normalized.id] || 0) < normalized.updatedAt
					? [normalized]
					: [];
			});
			const restored = restoredLibrary(stored, backup, true, now);
			return {
				clear: true,
				notes,
				labels: backup.labels,
				state: {
					[NOTE_IDB]: tombstones,
					[LABEL_IDB]: labelTombstones,
					[BOARD_IDB]: boardTombstones,
					[BOARDS_IDB]: JSON.parse(JSON.stringify(boards)),
					[CANVAS_LIBRARY_STATE_KEY]: restored.entries,
					[CANVAS_LIBRARY_TOMBSTONES_KEY]: restored.tombstones
				},
				dropState: control
					? [control.cursor, control.baseline, control.recordIds, control.relayAttachments]
					: [],
				outboxKeys: [
					...notes.flatMap(noteRecordKeys),
					...backup.labels.map((label) => `label:${label.id}`),
					...boards.map((board) => `board:${board.id}`),
					...tombstoneKeys('note', tombstones),
					...tombstoneKeys('label', labelTombstones),
					...tombstoneKeys('board', boardTombstones),
					...restored.keys
				]
			};
		}
	};
}

/**
 * Notes read from a Google Keep Takeout. Adding keeps everything the workspace
 * holds; replacing leaves only the Takeout's notes and labels and deletes the rest.
 */
export function planKeepImport(input: {
	notes: Note[];
	labels: Label[];
	mode: BackupImportMode;
	now: number;
}): ImportPlan {
	const { notes, labels, mode, now } = input;
	if (mode === BackupImportMode.Keep) {
		return {
			notes,
			stateKeys: [],
			land: (stored) => {
				const added = addLabels(stored.labels, labels, notes, now);
				return {
					clear: false,
					notes: added.notes,
					labels: added.labels,
					outboxKeys: [
						...added.notes.flatMap(noteRecordKeys),
						...added.labels.map((label) => `label:${label.id}`)
					]
				};
			}
		};
	}
	return {
		notes,
		stateKeys: [NOTE_IDB, LABEL_IDB],
		land: (stored) => {
			const kept = new Set(notes.map((note) => note.id));
			const keptLabels = new Set(labels.map((label) => label.id));
			const tombstones = sanitizeTombstones(stored.state[NOTE_IDB]);
			for (const id of stored.noteIds) if (!kept.has(id)) tombstones[id] = now;
			const labelTombstones = sanitizeTombstones(stored.state[LABEL_IDB]);
			for (const label of stored.labels)
				if (!keptLabels.has(label.id)) labelTombstones[label.id] = now;
			return {
				clear: true,
				notes,
				labels,
				state: { [NOTE_IDB]: tombstones, [LABEL_IDB]: labelTombstones },
				outboxKeys: [
					...notes.flatMap(noteRecordKeys),
					...labels.map((label) => `label:${label.id}`),
					...tombstoneKeys('note', tombstones),
					...tombstoneKeys('label', labelTombstones)
				]
			};
		}
	};
}
