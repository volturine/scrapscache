import { normalizeBoard, type KanbanBoard } from '$lib/kanban';
import {
	copyLabel,
	isReadableBodyDoc,
	NOTE_FIELDS,
	touchNoteFields,
	type EditContext
} from './model';
import type { LinkPreview } from '$lib/linkPreview';
import type { Layout, View } from '$lib/stores/ui.svelte';
import type { Label, Note, NoteFieldTimes, NoteImage } from '$lib/types';
import { cloneNote, uid } from '$lib/utils';

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
	version: 4;
	exportedAt: number;
	notes: Note[];
	labels: Label[];
	boards: KanbanBoard[];
	activeBoardId: string;
	tombstones: Record<string, number>;
	labelTombstones: Record<string, number>;
	boardTombstones: Record<string, number>;
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

type CurrentBackupRaw = Record<string, unknown> & {
	version: 4;
	exportedAt: number;
	notes: unknown[];
	labels: unknown[];
	boards: unknown[];
	activeBoardId: string;
	tombstones: object;
	labelTombstones: object;
	boardTombstones: object;
	ui: object;
};

function isCurrentBackupRaw(raw: Record<string, unknown>): raw is CurrentBackupRaw {
	const valid =
		raw.version === 4 &&
		typeof raw.exportedAt === 'number' &&
		Array.isArray(raw.notes) &&
		Array.isArray(raw.labels) &&
		Array.isArray(raw.boards) &&
		typeof raw.activeBoardId === 'string' &&
		!!raw.tombstones &&
		typeof raw.tombstones === 'object' &&
		!!raw.labelTombstones &&
		typeof raw.labelTombstones === 'object' &&
		!!raw.boardTombstones &&
		typeof raw.boardTombstones === 'object' &&
		!!raw.ui &&
		typeof raw.ui === 'object';
	return valid;
}

/** Validate and normalize the current backup format into a safe in-memory shape. */
export function normalizeBackup(data: unknown): ScrapsCacheBackup | null {
	if (!data || typeof data !== 'object') return null;
	const raw = data as Record<string, unknown>;
	if (!isCurrentBackupRaw(raw)) return null;
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
		version: 4,
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
