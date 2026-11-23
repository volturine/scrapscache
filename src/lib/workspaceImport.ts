// What a backup or a Google Keep import writes into a workspace. Each plan is
// decided from what the workspace holds at the moment it lands, and lands whole:
// see `rewriteWorkspace`. Nothing here touches the in-memory stores, so an import
// lands in the workspace it was started for whether or not that one is still open.
import type { Label, Note } from '#lib/types.js';
import type { RewritePlan, StoredWorkspace } from '#lib/db/idb.js';
import { BackupImportMode, type ScrapsCacheBackup } from '#lib/backup.js';
import {
	CANVAS_LIBRARY_STATE_KEY,
	CANVAS_LIBRARY_TOMBSTONES_KEY,
	isCanvasLibraryEntry,
	restoredCanvasLibrary
} from '#lib/canvasLibrary.js';
import { normalizeBoard, type KanbanBoard } from '#lib/kanban.js';
import { uid } from '#lib/model/index.js';
import { noteRecordKeys, syncControlKeys } from '#lib/syncEngine.js';
import { recordKey } from '#lib/syncRecords.js';
import {
	BOARD_IDB,
	BOARDS_IDB,
	LABEL_IDB,
	NOTE_IDB,
	sanitizeTombstones
} from '#lib/syncTombstones.js';

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

function tombstoneKeys(
	kind: 'note' | 'label' | 'board',
	tombstones: Record<string, number>
): string[] {
	return Object.keys(tombstones).map((id) => recordKey(`${kind}-tombstone`, id));
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
			tombstones: sanitizeTombstones(stored.state[CANVAS_LIBRARY_TOMBSTONES_KEY])
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
}): RewritePlan {
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
						...added.labels.map((label) => recordKey('label', label.id)),
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
		stateKeys: [NOTE_IDB, LABEL_IDB, BOARD_IDB, BOARDS_IDB, ...library],
		land: (stored) => {
			// The notes return under new ids, so every copy under an old id goes.
			const tombstones = {
				...sanitizeTombstones(stored.state[NOTE_IDB]),
				...sanitizeTombstones(backup.tombstones)
			};
			for (const id of [...stored.noteIds, ...importedIds.keys()]) tombstones[id] = now;
			// So do the labels and the boards. A delete is for good: under its old id a
			// label deleted since the backup was made would be taken away again by the
			// next sync, and one the backup does not have would come back with it. Under
			// new ids the backup's are safe, and every old one goes on every device.
			const labelIds = new Map(backup.labels.map((label) => [label.id, uid()]));
			const relabelled = (ids: readonly string[]) =>
				ids.flatMap((id) => {
					const imported = labelIds.get(id);
					return imported ? [imported] : [];
				});
			const labels = backup.labels.map((label) => ({ ...label, id: labelIds.get(label.id)! }));
			const labelTombstones = {
				...sanitizeTombstones(stored.state[LABEL_IDB]),
				...sanitizeTombstones(backup.labelTombstones)
			};
			for (const id of [...stored.labels.map((label) => label.id), ...labelIds.keys()])
				labelTombstones[id] = now;
			const deletedInBackup = sanitizeTombstones(backup.boardTombstones);
			const boardTombstones = {
				...sanitizeTombstones(stored.state[BOARD_IDB]),
				...deletedInBackup
			};
			const boards = backup.boards.flatMap((board): KanbanBoard[] => {
				const normalized = normalizeBoard({
					...board,
					columns: board.columns.map((column) => ({
						...column,
						labelId: column.labelId === null ? null : (labelIds.get(column.labelId) ?? null),
						order: column.order.flatMap((id) => {
							const imported = importedIds.get(id);
							return imported ? [imported] : [];
						})
					})),
					backlogFilter: {
						...board.backlogFilter,
						labelIds: relabelled(board.backlogFilter.labelIds)
					},
					noteFilter: { ...board.noteFilter, labelIds: relabelled(board.noteFilter.labelIds) }
				});
				return normalized && (deletedInBackup[normalized.id] || 0) < normalized.updatedAt
					? [{ ...normalized, id: uid() }]
					: [];
			});
			const before: unknown = stored.state[BOARDS_IDB];
			for (const board of [...(Array.isArray(before) ? before : []), ...backup.boards]) {
				const id = (board as { id?: unknown } | null)?.id;
				if (typeof id === 'string') boardTombstones[id] = now;
			}
			const restored = restoredLibrary(stored, backup, true, now);
			const relabelledNotes = notes.map((note) => ({ ...note, labels: relabelled(note.labels) }));
			return {
				clear: true,
				notes: relabelledNotes,
				labels,
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
					...relabelledNotes.flatMap(noteRecordKeys),
					...labels.map((label) => recordKey('label', label.id)),
					...boards.map((board) => recordKey('board', board.id)),
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
}): RewritePlan {
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
						...added.labels.map((label) => recordKey('label', label.id))
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
					...labels.map((label) => recordKey('label', label.id)),
					...tombstoneKeys('note', tombstones),
					...tombstoneKeys('label', labelTombstones)
				]
			};
		}
	};
}
