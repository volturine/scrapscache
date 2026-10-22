// Merging two copies of a record. Every merge is commutative and produces the
// same value on every device, or devices would re-upload each other's results
// forever.
//
// - Body edits on the same document base merge as a CRDT. Full replacements
//   change the base; the latest body write decides between those histories.
// - Attachments merge by id: adds from both sides survive, removals are
//   remembered, and two copies of one attachment keep the later content edit.
//   A later images edit that still contains an attachment puts it back.
// - Every other field is last-write-wins on its own time. Times come from the
//   relay-corrected clock (clock.ts); equal times fall back to the writer id.
import type { Label, Note, NoteField, NoteFieldTimes, NoteImage } from './types.js';
import { stableStringify } from './stableStringify.js';
import { mergeBodies, replaceBodySnapshot } from './bodyDoc.js';
import type { ReminderRepeat } from './reminderRepeat.js';

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

export type Side<T> = { value: T; time: number; writer?: string };

/**
 * The later write; equal times go to the larger writer id, then the larger value.
 * A missing writer counts as the smallest, so both devices pick the same side
 * whichever merges: otherwise each keeps its own copy and they re-upload forever.
 */
export function pickLatest<T>(left: Side<T>, right: Side<T>): Side<T> {
	if (left.time !== right.time) return left.time > right.time ? left : right;
	const leftWriter = left.writer ?? '';
	const rightWriter = right.writer ?? '';
	if (leftWriter !== rightWriter) return leftWriter > rightWriter ? left : right;
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
	const leftTime = fieldTime(left, 'images');
	const rightTime = fieldTime(right, 'images');
	const leftIds = new Set((left.images ?? []).map((image) => image.id));
	const rightIds = new Set((right.images ?? []).map((image) => image.id));
	const byId = new Map<string, NoteImage>();
	for (const image of [...(left.images ?? []), ...(right.images ?? [])]) {
		const buriedAt = imageTombstones[image.id] ?? 0;
		// Undo (or any newer images edit) that still lists the attachment wins.
		const restored =
			buriedAt > 0 &&
			((leftIds.has(image.id) && leftTime > buriedAt) ||
				(rightIds.has(image.id) && rightTime > buriedAt));
		if (buriedAt > 0 && !restored) continue;
		if (restored) delete imageTombstones[image.id];
		const existing = byId.get(image.id);
		byId.set(image.id, existing ? pickImage(existing, image) : image);
	}
	return { images: sortAttachments([...byId.values()]), imageTombstones };
}

/**
 * A reminder and its repeat as one value. At a tie between the same write, a
 * copy that kept the repeat orders after one that lost it (an app from before
 * repeats drops the field), so the repeat is not lost.
 */
function reminderOf(note: Note): [number | null, ReminderRepeat | null] {
	return [note.reminder ?? null, note.repeat ?? null];
}

export function mergeTwoNotes(left: Note, right: Note): Note {
	if (left === right) return left;
	const fieldTimes: NoteFieldTimes = {};
	const fieldWriters: Partial<Record<NoteField, string>> = {};
	const picked = {} as Record<NoteField, unknown>;
	for (const field of NOTE_FIELDS) {
		const winner =
			field === 'secret'
				? pickLatest(
						side(left, field, Boolean(left.secret)),
						side(right, field, Boolean(right.secret))
					)
				: field === 'reminder'
					? // A repeat is written with its reminder, so the two travel together.
						pickLatest(side(left, field, reminderOf(left)), side(right, field, reminderOf(right)))
					: pickLatest(side(left, field), side(right, field));
		picked[field] = winner.value;
		fieldTimes[field] = winner.time;
		if (winner.writer) fieldWriters[field] = winner.writer;
	}
	if (!left.fieldTimes?.secret && !right.fieldTimes?.secret && !left.secret && !right.secret) {
		delete fieldTimes.secret;
		delete fieldWriters.secret;
	}

	let body: Pick<Note, 'body' | 'bodyDoc'> = { body: picked.body as string };
	if (left.bodyDoc && right.bodyDoc) {
		const leftWrite = side(left, 'body');
		const rightWrite = side(right, 'body');
		const identicalWrite =
			leftWrite.time === rightWrite.time &&
			(leftWrite.writer ?? '') === (rightWrite.writer ?? '') &&
			leftWrite.value === rightWrite.value;
		const preferred = identicalWrite
			? undefined
			: pickLatest(leftWrite, rightWrite) === leftWrite
				? 'left'
				: 'right';
		// Concurrent edits to the same body base survive together. A full replacement
		// changes that base; the body write clock then decides between the histories.
		body = mergeBodies(
			{ body: left.body, bodyDoc: left.bodyDoc },
			{ body: right.body, bodyDoc: right.bodyDoc },
			preferred
		);
	} else {
		const documented = left.bodyDoc ? left : right;
		if (documented.bodyDoc) {
			const plain = left.bodyDoc ? right : left;
			const documentWrite = side(documented, 'body');
			const plainWrite = side(plain, 'body');
			const sameWrite =
				documentWrite.time === plainWrite.time &&
				(documentWrite.writer ?? '') === (plainWrite.writer ?? '');
			// A plain-text snapshot has no operations to merge. A newer full write
			// starts one canonical replacement that every receiving device shares.
			// At the same write stamp, the document may also hold other concurrent edits.
			const document = { body: documented.body, bodyDoc: documented.bodyDoc };
			body =
				sameWrite || pickLatest(documentWrite, plainWrite) === documentWrite
					? document
					: replaceBodySnapshot(document, plain.body, plainWrite);
		}
	}
	const { images, imageTombstones } = mergeImages(left, right);

	const trashed = picked.trashed as boolean;
	const trashedAt = trashed
		? Math.max(Number(left.trashedAt) || 0, Number(right.trashedAt) || 0) ||
			(fieldTimes.trashed ?? 0)
		: null;
	const linkPreviews = picked.linkPreviews as Note['linkPreviews'];
	const [reminder, repeat] = picked.reminder as ReturnType<typeof reminderOf>;
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
		reminder,
		...(reminder != null && repeat ? { repeat } : {}),
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
	return pickLatest(
		{ value: primary, time: primary.updatedAt, writer: primary.writer },
		{ value: secondary, time: secondary.updatedAt, writer: secondary.writer }
	).value;
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
