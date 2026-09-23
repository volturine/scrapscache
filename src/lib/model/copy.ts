// Plain, complete copies of records. Storage, backups, and sync all copy notes
// through here, so a field added to Note cannot be dropped by one of them.
import type { LinkPreview, Note, NoteField, NoteImage } from './types.js';
import { NOTE_FIELDS } from './merge.js';

function finite(value: unknown): number | undefined {
	const number = Number(value);
	return value != null && Number.isFinite(number) ? number : undefined;
}

function timeMap(value: unknown): Record<string, number> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).flatMap(([key, time]) => {
			const parsed = finite(time);
			return parsed !== undefined && parsed > 0 ? [[key, parsed]] : [];
		})
	);
}

function fieldMap<T>(
	value: unknown,
	parse: (entry: unknown) => T | undefined
): Partial<Record<NoteField, T>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).flatMap(([field, entry]) => {
			const parsed = parse(entry);
			return (NOTE_FIELDS as string[]).includes(field) && parsed !== undefined
				? [[field, parsed]]
				: [];
		})
	);
}

export function copyImage(image: NoteImage): NoteImage {
	const width = finite(image.width);
	const height = finite(image.height);
	const byteSize = finite(image.byteSize);
	const encodingVersion = finite(image.encodingVersion);
	const editedAt = finite(image.editedAt);
	return {
		id: String(image.id),
		mime: String(image.mime || 'application/octet-stream'),
		dataUrl: typeof image.dataUrl === 'string' ? image.dataUrl : '',
		createdAt: finite(image.createdAt) ?? 0,
		...(editedAt !== undefined ? { editedAt } : {}),
		...(typeof image.name === 'string' && image.name ? { name: image.name } : {}),
		...(typeof image.thumbUrl === 'string' && image.thumbUrl ? { thumbUrl: image.thumbUrl } : {}),
		...(width !== undefined ? { width } : {}),
		...(height !== undefined ? { height } : {}),
		...(byteSize !== undefined ? { byteSize } : {}),
		...(typeof image.contentHash === 'string' && image.contentHash
			? { contentHash: image.contentHash }
			: {}),
		...(encodingVersion !== undefined ? { encodingVersion } : {})
	};
}

export function copyLinkPreview(preview: LinkPreview): LinkPreview {
	return {
		url: String(preview.url),
		hostname: String(preview.hostname),
		title: String(preview.title),
		...(preview.description ? { description: String(preview.description) } : {}),
		...(preview.image ? { image: String(preview.image) } : {}),
		...(preview.icon ? { icon: String(preview.icon) } : {})
	};
}

export function copyNote(note: Note): Note {
	const fieldTimes = fieldMap(note.fieldTimes, (time) => {
		const parsed = finite(time);
		return parsed !== undefined && parsed > 0 ? parsed : undefined;
	});
	const fieldWriters = fieldMap(note.fieldWriters, (writer) =>
		typeof writer === 'string' && writer ? writer : undefined
	);
	const imageTombstones = timeMap(note.imageTombstones);
	const linkPreviews = (note.linkPreviews ?? []).map(copyLinkPreview);
	return {
		id: String(note.id),
		title: String(note.title ?? ''),
		body: String(note.body ?? ''),
		...(typeof note.bodyDoc === 'string' && note.bodyDoc ? { bodyDoc: note.bodyDoc } : {}),
		color: note.color,
		pinned: Boolean(note.pinned),
		archived: Boolean(note.archived),
		trashed: Boolean(note.trashed),
		trashedAt: note.trashedAt == null ? null : Number(note.trashedAt),
		...(note.secret ? { secret: true } : {}),
		createdAt: finite(note.createdAt) ?? 0,
		updatedAt: finite(note.updatedAt) ?? 0,
		reminder: note.reminder == null ? null : Number(note.reminder),
		labels: Array.from(note.labels ?? [], (id) => String(id)),
		...(note.images ? { images: note.images.map(copyImage) } : {}),
		...(Object.keys(imageTombstones).length ? { imageTombstones } : {}),
		...(linkPreviews.length ? { linkPreviews } : {}),
		...(note.fieldTimes ? { fieldTimes } : {}),
		...(Object.keys(fieldWriters).length ? { fieldWriters } : {})
	};
}
