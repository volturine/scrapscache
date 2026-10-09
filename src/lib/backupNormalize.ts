// Reading a backup file back in. Kept apart from backup.ts so the validation, and
// the Effect Schema it uses, load only when someone imports a backup.
import { Schema } from 'effect';
import type { ScrapsCacheBackup } from '#lib/backup.js';
import { normalizeBoard } from '#lib/kanban.js';
import { copyLabel, isReadableBodyDoc, NOTE_FIELDS } from './model';
import type { LinkPreview } from '#lib/linkPreview.js';
import type { View } from '#lib/stores/ui.svelte.js';
import type { Label, Note, NoteFieldTimes, NoteImage } from '#lib/types.js';
import { cloneNote } from '#lib/utils.js';
import { isCanvasLibraryItem } from '#lib/canvasLibrary.js';
import { isReminderHistoryEntry } from '#lib/reminderHistory.js';

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

const Items = Schema.Array(Schema.Unknown);
const Fields = Schema.Record(Schema.String, Schema.Unknown);
const backupFields = {
	exportedAt: Schema.Number,
	notes: Items,
	labels: Items,
	boards: Items,
	activeBoardId: Schema.String,
	tombstones: Fields,
	labelTombstones: Fields,
	boardTombstones: Fields,
	ui: Fields
};

const isCurrentBackupRaw = Schema.is(
	Schema.Union([
		/** Version 4 predates the canvas library and reminder history; it imports with neither. */
		Schema.Struct({
			...backupFields,
			version: Schema.Literal(4),
			canvasLibrary: Schema.optional(Items),
			reminderHistory: Schema.optional(Items)
		}),
		Schema.Struct({
			...backupFields,
			version: Schema.Literal(5),
			canvasLibrary: Items,
			reminderHistory: Items
		})
	])
);

/** Validate and normalize the current backup format into a safe in-memory shape. */
export function normalizeBackup(data: unknown): ScrapsCacheBackup | null {
	if (!isCurrentBackupRaw(data)) return null;
	const raw = data;
	const notes = raw.notes.flatMap((item): Note[] => {
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
	const uiRaw = raw.ui;
	return {
		version: 5,
		exportedAt: Number(raw.exportedAt) || Date.now(),
		notes,
		labels,
		boards: raw.boards.flatMap((board) => {
			const normalized = normalizeBoard(board);
			return normalized ? [normalized] : [];
		}),
		activeBoardId: raw.activeBoardId,
		tombstones: asTombstoneMap(raw.tombstones),
		labelTombstones: asTombstoneMap(raw.labelTombstones),
		boardTombstones: asTombstoneMap(raw.boardTombstones),
		canvasLibrary: (raw.canvasLibrary ?? []).filter(isCanvasLibraryItem),
		reminderHistory: (raw.reminderHistory ?? []).filter(isReminderHistoryEntry),
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
