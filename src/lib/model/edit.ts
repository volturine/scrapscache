// The one way to change a note. Every writer (the app, imports, the MCP server)
// goes through applyNoteEdit, so none can stamp a field it did not change: a
// stamped but unchanged field would carry a stale value past a newer edit made
// elsewhere.
import type { Note, NoteField, NoteImage } from './types.js';
import { stableStringify } from './stableStringify.js';
import { BodyAuthor } from './bodyDoc.js';
import { NOTE_FIELDS, fieldTime, sortAttachments } from './merge.js';

export type NotePatch = Partial<Pick<Note, NoteField | 'trashedAt'>>;

/** Who writes, and on which clock. */
export type EditContext = {
	now(): number;
	/** Breaks ties between equal field times; unique per writer. */
	writer: string;
	author: BodyAuthor;
};

export function createEditContext(now: () => number): EditContext {
	return { now, writer: crypto.randomUUID(), author: new BodyAuthor() };
}

/** Stamp fields as written now by this writer, each strictly after its previous time. */
export function touchNoteFields(note: Note, fields: NoteField[], context: EditContext): Note {
	const at = context.now();
	const fieldTimes = { ...note.fieldTimes };
	const fieldWriters = { ...note.fieldWriters };
	for (const field of fields) {
		fieldTimes[field] = Math.max(at, fieldTime(note, field) + 1);
		fieldWriters[field] = context.writer;
	}
	return {
		...note,
		updatedAt: Math.max(note.updatedAt, ...Object.values(fieldTimes)),
		fieldTimes,
		fieldWriters
	};
}

/**
 * Whether two copies of one attachment hold different content. Metadata that
 * only fills in later (hashes, sizes, loaded bytes) is not a change.
 */
function attachmentContentChanged(before: NoteImage, after: NoteImage): boolean {
	if (before.contentHash && after.contentHash) return before.contentHash !== after.contentHash;
	if (before.dataUrl && after.dataUrl) return before.dataUrl !== after.dataUrl;
	return false;
}

function sameAttachments(before: NoteImage[], after: NoteImage[]): boolean {
	if (before.length !== after.length) return false;
	const byId = new Map(before.map((image) => [image.id, image]));
	return after.every((image) => {
		const previous = byId.get(image.id);
		return !!previous && !attachmentContentChanged(previous, image);
	});
}

function sameValue(field: NoteField, note: Note, patch: NotePatch): boolean {
	switch (field) {
		case 'images':
			return sameAttachments(note.images ?? [], patch.images ?? []);
		case 'linkPreviews':
			return stableStringify(note.linkPreviews ?? []) === stableStringify(patch.linkPreviews ?? []);
		case 'secret':
			return Boolean(note.secret) === Boolean(patch.secret);
		case 'reminder':
			return (note.reminder ?? null) === (patch.reminder ?? null);
		default:
			return stableStringify(note[field]) === stableStringify(patch[field]);
	}
}

/** Removed attachments are remembered; a changed attachment records when its content changed. */
function editAttachments(note: Note, next: NoteImage[], at: number): Partial<Note> {
	const before = new Map((note.images ?? []).map((image) => [image.id, image]));
	const kept = new Set(next.map((image) => image.id));
	const imageTombstones = { ...note.imageTombstones };
	for (const id of before.keys()) if (!kept.has(id)) imageTombstones[id] = at;
	const images = next.map((image) => {
		const previous = before.get(image.id);
		if (!previous) return { ...image };
		// The stored copy may know more (a hash, a size) than an editor's draft of it.
		return attachmentContentChanged(previous, image)
			? { ...image, editedAt: at }
			: { ...previous, ...(image.dataUrl ? { dataUrl: image.dataUrl } : {}) };
	});
	return {
		images: sortAttachments(images),
		...(Object.keys(imageTombstones).length ? { imageTombstones } : {})
	};
}

/**
 * Apply a patch, stamping only the fields whose value actually changes.
 * Returns the same note object when nothing changed.
 */
export function applyNoteEdit(note: Note, patch: NotePatch, context: EditContext): Note {
	const changed = NOTE_FIELDS.filter((field) => field in patch && !sameValue(field, note, patch));
	const trashedAt = 'trashedAt' in patch ? (patch.trashedAt ?? null) : note.trashedAt;
	if (changed.length === 0 && trashedAt === note.trashedAt) return note;

	const next: Note = { ...note, trashedAt };
	const at = context.now();
	for (const field of changed) {
		switch (field) {
			case 'body':
				Object.assign(next, context.author.edit(note.id, note, patch.body ?? ''));
				break;
			case 'images':
				Object.assign(next, editAttachments(note, patch.images ?? [], at));
				break;
			case 'secret':
				if (patch.secret) next.secret = true;
				else delete next.secret;
				break;
			case 'labels':
				next.labels = [...(patch.labels ?? [])];
				break;
			case 'linkPreviews':
				if (patch.linkPreviews?.length) {
					next.linkPreviews = patch.linkPreviews.map((preview) => ({ ...preview }));
				} else delete next.linkPreviews;
				break;
			default:
				Object.assign(next, { [field]: patch[field] });
		}
	}
	return touchNoteFields(next, changed, context);
}
