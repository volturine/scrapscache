import { normalizeBoard, type KanbanBoard } from '#lib/kanban.js';
import {
	copyLabel,
	isReadableBodyDoc,
	NOTE_FIELDS,
	touchNoteFields,
	uid,
	type EditContext
} from './model';
import type { LinkPreview } from '#lib/linkPreview.js';
import type { Layout, View } from '#lib/stores/ui.svelte.js';
import type { Label, Note, NoteFieldTimes, NoteImage } from '#lib/types.js';
import { cloneNote } from '#lib/utils.js';
import { isCanvasLibraryItem, type CanvasLibraryItem } from '#lib/canvasLibrary.js';
import { isReminderHistoryEntry, type ReminderHistoryEntry } from '#lib/reminderHistory.js';
import { reminderWakeId } from '#lib/model/index.js';
import { Schema } from 'effect';

const NOTE_COLORS = new Set<Note['color']>([
	'default',
	'red',
	'orange',
	'yellow',
	'green',
	'teal',
	'blue',
	'darkblue',
	'purple',
	'pink',
	'brown',
	'gray'
]);
const VIEWS = new Set<View>(['notes', 'kanban', 'reminders', 'archive', 'trash', 'label']);

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

function asTombstoneMap(value: unknown): Record<string, number> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).flatMap(([id, timestamp]) => {
			const parsed = Number(timestamp);
			return typeof id === 'string' && Number.isFinite(parsed) && parsed > 0 ? [[id, parsed]] : [];
		})
	);
}

function asFieldTimes(value: unknown): NoteFieldTimes {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).flatMap(([field, time]) => {
			const parsed = Number(time);
			return (NOTE_FIELDS as string[]).includes(field) && Number.isFinite(parsed) && parsed > 0
				? [[field, parsed]]
				: [];
		})
	);
}

function normalizeImage(value: unknown): NoteImage | null {
	if (!value || typeof value !== 'object') return null;
	const image = value as Partial<NoteImage>;
	if (typeof image.id !== 'string') return null;
	return {
		id: image.id,
		mime: String(image.mime || 'application/octet-stream'),
		dataUrl: typeof image.dataUrl === 'string' ? image.dataUrl : '',
		createdAt: Number(image.createdAt) || 0,
		...(typeof image.name === 'string' && image.name ? { name: image.name } : {}),
		...(typeof image.thumbUrl === 'string' && image.thumbUrl ? { thumbUrl: image.thumbUrl } : {}),
		...(Number.isFinite(image.width) ? { width: Number(image.width) } : {}),
		...(Number.isFinite(image.height) ? { height: Number(image.height) } : {}),
		...(Number.isFinite(image.byteSize) ? { byteSize: Number(image.byteSize) } : {}),
		...(typeof image.contentHash === 'string' && image.contentHash
			? { contentHash: image.contentHash }
			: {}),
		...(Number.isFinite(image.encodingVersion)
			? { encodingVersion: Number(image.encodingVersion) }
			: {}),
		...(Number.isFinite(image.editedAt) ? { editedAt: Number(image.editedAt) } : {})
	};
}

function normalizeLinkPreview(value: unknown): LinkPreview | null {
	if (!value || typeof value !== 'object') return null;
	const preview = value as Partial<LinkPreview>;
	if (
		typeof preview.url !== 'string' ||
		typeof preview.hostname !== 'string' ||
		typeof preview.title !== 'string'
	) {
		return null;
	}
	return {
		url: preview.url,
		hostname: preview.hostname,
		title: preview.title,
		...(typeof preview.description === 'string' ? { description: preview.description } : {}),
		...(typeof preview.image === 'string' ? { image: preview.image } : {}),
		...(typeof preview.icon === 'string' ? { icon: preview.icon } : {})
	};
}

const CurrentBackupRawSchema = Schema.Union([
	Schema.Struct({
		version: Schema.Literal(4),
		exportedAt: Schema.Number,
		notes: Schema.Array(Schema.Unknown),
		labels: Schema.Array(Schema.Unknown),
		boards: Schema.Array(Schema.Unknown),
		activeBoardId: Schema.String,
		tombstones: Schema.Record(Schema.String, Schema.Unknown),
		labelTombstones: Schema.Record(Schema.String, Schema.Unknown),
		boardTombstones: Schema.Record(Schema.String, Schema.Unknown),
		canvasLibrary: Schema.optional(Schema.Array(Schema.Unknown)),
		reminderHistory: Schema.optional(Schema.Array(Schema.Unknown)),
		ui: Schema.Record(Schema.String, Schema.Unknown)
	}),
	Schema.Struct({
		version: Schema.Literal(5),
		exportedAt: Schema.Number,
		notes: Schema.Array(Schema.Unknown),
		labels: Schema.Array(Schema.Unknown),
		boards: Schema.Array(Schema.Unknown),
		activeBoardId: Schema.String,
		tombstones: Schema.Record(Schema.String, Schema.Unknown),
		labelTombstones: Schema.Record(Schema.String, Schema.Unknown),
		boardTombstones: Schema.Record(Schema.String, Schema.Unknown),
		canvasLibrary: Schema.Array(Schema.Unknown),
		reminderHistory: Schema.Array(Schema.Unknown),
		ui: Schema.Record(Schema.String, Schema.Unknown)
	})
]);

type CurrentBackupRaw = Schema.Schema.Type<typeof CurrentBackupRawSchema>;
const isCurrentBackupRaw = Schema.is(CurrentBackupRawSchema);

/** Validate and normalize the current backup format into a safe in-memory shape. */
export function normalizeBackup(data: unknown): ScrapsCacheBackup | null {
	if (!isCurrentBackupRaw(data)) return null;
	const raw = data;
	const notes = (raw.notes as unknown[]).flatMap((item): Note[] => {
		if (!item || typeof item !== 'object') return [];
		const note = item as Partial<Note>;
		if (typeof note.id !== 'string') return [];
		const color = NOTE_COLORS.has(note.color as Note['color'])
			? (note.color as Note['color'])
			: 'default';
		const images = Array.isArray(note.images)
			? note.images.flatMap((image) => {
					const normalized = normalizeImage(image);
					return normalized ? [normalized] : [];
				})
			: [];
		return [
			cloneNote({
				id: note.id,
				title: String(note.title ?? ''),
				body: String(note.body ?? ''),
				...(isReadableBodyDoc(note.bodyDoc) ? { bodyDoc: note.bodyDoc } : {}),
				color,
				pinned: Boolean(note.pinned),
				archived: Boolean(note.archived),
				trashed: Boolean(note.trashed),
				...(note.secret ? { secret: true } : {}),
				trashedAt: note.trashedAt == null ? null : Number(note.trashedAt),
				createdAt: Number(note.createdAt) || 0,
				updatedAt: Number(note.updatedAt) || 0,
				reminder: note.reminder == null ? null : Number(note.reminder),
				labels: Array.isArray(note.labels) ? note.labels.map(String) : [],
				images,
				...(note.fieldTimes && typeof note.fieldTimes === 'object'
					? { fieldTimes: asFieldTimes(note.fieldTimes) }
					: {}),
				...(note.fieldWriters ? { fieldWriters: note.fieldWriters } : {}),
				...(note.imageTombstones ? { imageTombstones: note.imageTombstones } : {}),
				linkPreviews: Array.isArray(note.linkPreviews)
					? note.linkPreviews.flatMap((preview) => {
							const normalized = normalizeLinkPreview(preview);
							return normalized ? [normalized] : [];
						})
					: []
			})
		];
	});
	const labels = (raw.labels as Label[]).flatMap((label): Label[] => {
		if (!label || typeof label !== 'object' || typeof label.id !== 'string') return [];
		return [copyLabel(label)];
	});
	const uiRaw = raw.ui && typeof raw.ui === 'object' ? (raw.ui as Record<string, unknown>) : {};
	return {
		version: 5,
		exportedAt: Number(raw.exportedAt) || Date.now(),
		notes,
		labels,
		boards: (raw.boards as unknown[]).flatMap((board) => {
			const normalized = normalizeBoard(board);
			return normalized ? [normalized] : [];
		}),
		activeBoardId: raw.activeBoardId,
		tombstones: asTombstoneMap(raw.tombstones),
		labelTombstones: asTombstoneMap(raw.labelTombstones),
		boardTombstones: asTombstoneMap(raw.boardTombstones),
		canvasLibrary: ((raw.canvasLibrary ?? []) as unknown[]).filter(isCanvasLibraryItem),
		reminderHistory: ((raw.reminderHistory ?? []) as unknown[]).filter(isReminderHistoryEntry),
		ui: {
			sidebarOpen: typeof uiRaw.sidebarOpen === 'boolean' ? uiRaw.sidebarOpen : true,
			dark:
				typeof uiRaw.dark === 'boolean' || uiRaw.dark === null
					? (uiRaw.dark as boolean | null)
					: null,
			layout: uiRaw.layout === 'list' ? 'list' : 'grid',
			view: VIEWS.has(uiRaw.view as View) ? (uiRaw.view as View) : 'notes',
			rawMarkdown: uiRaw.rawMarkdown === true
		}
	};
}
