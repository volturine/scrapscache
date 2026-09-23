// Merging two copies of a record. Every merge is commutative and produces the
// same value on every device, or devices would re-upload each other's results
// forever.
//
// - The body is a CRDT text document: both sides' edits survive.
// - Attachments merge by id: adds from both sides survive, removals are
//   remembered, and two copies of one attachment keep the later content edit.
// - Every other field is last-write-wins on its own time. Times come from the
//   relay-corrected clock (clock.ts); equal times fall back to the writer id.
import type { Label, Note, NoteField, NoteFieldTimes, NoteImage } from './types.js';
import { stableStringify } from './stableStringify.js';
import { mergeBodies } from './bodyDoc.js';

export const NOTE_FIELDS: NoteField[] = [
	'title',
	'body',
	'color',
	'pinned',
	'archived',
	'trashed',
	'secret',
	'reminder',
	'labels',
	'images',
	'linkPreviews'
];

function equalTimestampWinner<T>(left: T, right: T): T {
	return stableStringify(left) >= stableStringify(right) ? left : right;
}

export function fieldTime(note: Note, field: NoteField): number {
	return Number(note.fieldTimes?.[field]) || note.updatedAt;
}

type Side<T> = { value: T; time: number; writer?: string };

function pickField<T>(left: Side<T>, right: Side<T>): Side<T> {
	if (left.time !== right.time) return left.time > right.time ? left : right;
	if (left.writer && right.writer && left.writer !== right.writer) {
		return left.writer > right.writer ? left : right;
	}
	return equalTimestampWinner(left.value, right.value) === left.value ? left : right;
}

function side<K extends NoteField>(
	note: Note,
	field: K,
	value: unknown = note[field]
): Side<unknown> {
	return { value, time: fieldTime(note, field), writer: note.fieldWriters?.[field] };
}

/** Permanent delete wins until the tombstone is explicitly cleared. */
export function isTombstoned(id: string, tombstones: Record<string, number>): boolean {
	return (Number(tombstones[id]) || 0) > 0;
}

export function withoutTombstoned<T extends { id: string }>(
	records: T[],
	tombstones: Record<string, number>
): T[] {
	return records.filter((record) => !isTombstoned(record.id, tombstones));
}

function mergeTimes(
	left: Record<string, number> = {},
	right: Record<string, number> = {}
): Record<string, number> {
	const merged = { ...left };
	for (const [id, time] of Object.entries(right)) merged[id] = Math.max(merged[id] ?? 0, time);
	return merged;
}

/** Attachments in the order they were added, identical on every device. */
export function sortAttachments(images: NoteImage[]): NoteImage[] {
	return [...images].sort(
		(left, right) =>
			(left.createdAt || 0) - (right.createdAt || 0) || left.id.localeCompare(right.id)
	);
}

function withoutBytes(image: NoteImage): Omit<NoteImage, 'dataUrl' | 'thumbUrl'> {
	const { dataUrl: _dataUrl, thumbUrl: _thumbUrl, ...meta } = image;
	return meta;
}

function imageTime(image: NoteImage): number {
	return image.editedAt ?? image.createdAt ?? 0;
}

/**
 * The later content edit wins. Copies of the same content combine what each
 * holds (loaded bytes, a thumbnail, a hash that filled in later).
 */
function pickImage(left: NoteImage, right: NoteImage): NoteImage {
	const leftMeta = withoutBytes(left);
	const winner =
		imageTime(left) !== imageTime(right)
			? imageTime(left) > imageTime(right)
				? left
				: right
			: equalTimestampWinner(leftMeta, withoutBytes(right)) === leftMeta
				? left
				: right;
	const other = winner === left ? right : left;
	const sameContent =
		imageTime(left) === imageTime(right) &&
		(!left.contentHash || !right.contentHash || left.contentHash === right.contentHash);
	if (!sameContent) return winner;
	const thumbUrl = winner.thumbUrl || other.thumbUrl;
	return {
		...other,
		...winner,
		dataUrl: winner.dataUrl || other.dataUrl || '',
		...(thumbUrl ? { thumbUrl } : {})
	};
}

function mergeImages(
	left: Note,
	right: Note
): { images: NoteImage[]; imageTombstones: Record<string, number> } {
	const imageTombstones = mergeTimes(left.imageTombstones, right.imageTombstones);
	const byId = new Map<string, NoteImage>();
	for (const image of [...(left.images ?? []), ...(right.images ?? [])]) {
		if (imageTombstones[image.id]) continue;
		const existing = byId.get(image.id);
		byId.set(image.id, existing ? pickImage(existing, image) : image);
	}
	return { images: sortAttachments([...byId.values()]), imageTombstones };
}

export function mergeTwoNotes(left: Note, right: Note): Note {
	if (left === right) return left;
	const fieldTimes: NoteFieldTimes = {};
	const fieldWriters: Partial<Record<NoteField, string>> = {};
	const picked = {} as Record<NoteField, unknown>;
	for (const field of NOTE_FIELDS) {
		const winner =
			field === 'secret'
				? pickField(
						side(left, field, Boolean(left.secret)),
						side(right, field, Boolean(right.secret))
					)
				: pickField(side(left, field), side(right, field));
		picked[field] = winner.value;
		fieldTimes[field] = winner.time;
		if (winner.writer) fieldWriters[field] = winner.writer;
	}
	if (!left.fieldTimes?.secret && !right.fieldTimes?.secret && !left.secret && !right.secret) {
		delete fieldTimes.secret;
		delete fieldWriters.secret;
	}

	// Concurrent body edits both survive; the field time only records the latest edit.
	const body =
		left.bodyDoc || right.bodyDoc
			? mergeBodies(left, right)
			: { body: picked.body as string, bodyDoc: undefined };
	const { images, imageTombstones } = mergeImages(left, right);

	const trashed = picked.trashed as boolean;
	const trashedAt = trashed
		? Math.max(Number(left.trashedAt) || 0, Number(right.trashedAt) || 0) ||
			(fieldTimes.trashed ?? 0)
		: null;
	const linkPreviews = picked.linkPreviews as Note['linkPreviews'];
	return {
		id: left.id,
		title: picked.title as string,
		body: body.body,
		...(body.bodyDoc ? { bodyDoc: body.bodyDoc } : {}),
		color: picked.color as Note['color'],
		pinned: picked.pinned as boolean,
		archived: picked.archived as boolean,
		trashed,
		trashedAt,
		...(picked.secret ? { secret: true } : {}),
		createdAt: Math.min(left.createdAt || right.createdAt, right.createdAt || left.createdAt),
		updatedAt: Math.max(left.updatedAt, right.updatedAt, ...Object.values(fieldTimes)),
		reminder: picked.reminder as number | null,
		labels: [...(picked.labels as string[])],
		images,
		...(Object.keys(imageTombstones).length ? { imageTombstones } : {}),
		...(linkPreviews?.length ? { linkPreviews } : {}),
		fieldTimes,
		...(Object.keys(fieldWriters).length ? { fieldWriters } : {})
	};
}

export function mergeNoteLists(primary: Note[], secondary: Note[]): Note[] {
	const byId = new Map<string, Note>();
	for (const note of primary) byId.set(note.id, note);
	for (const note of secondary) {
		const existing = byId.get(note.id);
		byId.set(note.id, existing ? mergeTwoNotes(existing, note) : note);
	}
	return Array.from(byId.values());
}

function nextUnusedId(taken: Set<string>, newId: () => string): string {
	let id = newId();
	while (taken.has(id)) id = newId();
	taken.add(id);
	return id;
}

/**
 * Pairing merge keeps both copies when this device and the account already
 * use the same note or attachment id. Regular sync still merges by id.
 */
export function retargetLocalNotes(
	local: Note[],
	remoteNotes: Note[],
	remoteTombstones: Record<string, number>,
	newId: () => string
): Note[] {
	const takenNoteIds = new Set<string>([
		...remoteNotes.map((note) => note.id),
		...Object.keys(remoteTombstones).filter((id) => isTombstoned(id, remoteTombstones)),
		...local.map((note) => note.id)
	]);
	const remoteImageIds = new Set(
		remoteNotes.flatMap((note) => (note.images ?? []).map((image) => image.id))
	);
	const takenImageIds = new Set<string>([
		...remoteImageIds,
		...local.flatMap((note) => (note.images ?? []).map((image) => image.id))
	]);

	return local.map((note) => {
		const collideNote =
			remoteNotes.some((remote) => remote.id === note.id) ||
			isTombstoned(note.id, remoteTombstones);
		const images = (note.images ?? []).map((image) => {
			if (!collideNote && !remoteImageIds.has(image.id)) return image;
			return { ...image, id: nextUnusedId(takenImageIds, newId) };
		});
		const imagesChanged = images.some(
			(image, index) => image.id !== (note.images ?? [])[index]?.id
		);
		if (!collideNote && !imagesChanged) return note;
		return {
			...note,
			id: collideNote ? nextUnusedId(takenNoteIds, newId) : note.id,
			images
		};
	});
}

export function mergeTwoLabels(primary: Label, secondary: Label): Label {
	return primary.updatedAt === secondary.updatedAt
		? equalTimestampWinner(primary, secondary)
		: primary.updatedAt > secondary.updatedAt
			? primary
			: secondary;
}

export function mergeLabelLists(primary: Label[], secondary: Label[]): Label[] {
	const byId = new Map<string, Label>();
	for (const label of primary) byId.set(label.id, label);
	for (const label of secondary) {
		const existing = byId.get(label.id);
		byId.set(label.id, existing ? mergeTwoLabels(existing, label) : label);
	}
	return Array.from(byId.values());
}
