import type { KanbanBoard } from '#lib/kanban.js';
import { NOTE_FIELDS, touchNoteFields, uid, type EditContext } from './model';
import type { Layout, View } from '#lib/stores/ui.svelte.js';
import type { Label, Note } from '#lib/types.js';
import { cloneNote } from '#lib/utils.js';
import type { CanvasLibraryItem } from '#lib/canvasLibrary.js';
import type { ReminderHistoryEntry } from '#lib/reminderHistory.js';
import { reminderWakeId } from '#lib/model/index.js';

/** Current-workspace snapshot, including full-resolution attachments. Never carries sync identity. */
export type ScrapsCacheBackup = {
	version: 5;
	exportedAt: number;
	notes: Note[];
	labels: Label[];
	boards: KanbanBoard[];
	activeBoardId: string;
	tombstones: Record<string, number>;
	labelTombstones: Record<string, number>;
	boardTombstones: Record<string, number>;
	/** The workspace's reusable canvas shapes, as Excalidraw keeps them. */
	canvasLibrary: CanvasLibraryItem[];
	/** Reminders already shown or dismissed, so a restore does not show them again. */
	reminderHistory: ReminderHistoryEntry[];
	ui: {
		sidebarOpen: boolean;
		dark: boolean | null;
		layout: Layout;
		view: View;
		rawMarkdown: boolean;
	};
};

export const BackupImportMode = {
	Keep: 'keep',
	Replace: 'replace'
} as const;
export type BackupImportMode = (typeof BackupImportMode)[keyof typeof BackupImportMode];

export const BackupOperation = {
	Export: 'export',
	Import: 'import'
} as const;
export type BackupOperation = (typeof BackupOperation)[keyof typeof BackupOperation];

/**
 * Make imported notes current under fresh note ids, in the same order as
 * `notes`. A note body merges with every other copy of its id, so restoring
 * under the old id would blend the backup into newer synced text instead of
 * replacing it. Additive imports also need fresh attachment ids.
 */
export function prepareImportedNotes(
	notes: Note[],
	mode: BackupImportMode,
	context: EditContext
): Note[] {
	const now = context.now();
	return notes.map((source) => {
		const note = cloneNote(source);
		const { imageTombstones: _removed, fieldWriters: _writers, ...rest } = note;
		return touchNoteFields(
			{
				...rest,
				id: uid(),
				createdAt: now,
				updatedAt: now,
				trashedAt: note.trashed ? now : null,
				fieldTimes: {},
				// Distinct times keep the attachments in their original order.
				images: (note.images ?? []).map((image, index) => ({
					...image,
					id: mode === BackupImportMode.Keep ? uid() : image.id,
					createdAt: now + index
				}))
			},
			NOTE_FIELDS,
			context
		);
	});
}

/**
 * Carry reminder history over to the ids a restore gives its notes. Only the
 * history of each note's current reminder matters; the rest described
 * reminders the note no longer has.
 */
export function importedReminderHistory(
	backupNotes: Note[],
	importedNotes: Note[],
	history: ReminderHistoryEntry[]
): ReminderHistoryEntry[] {
	const byId = new Map(history.map((entry) => [entry.id, entry]));
	return backupNotes.flatMap((source, index): ReminderHistoryEntry[] => {
		const imported = importedNotes[index];
		if (source.reminder == null || !imported || imported.reminder !== source.reminder) return [];
		const entry = byId.get(reminderWakeId(source.id, source.reminder));
		if (!entry) return [];
		return [{ ...entry, id: reminderWakeId(imported.id, imported.reminder), noteId: imported.id }];
	});
}
