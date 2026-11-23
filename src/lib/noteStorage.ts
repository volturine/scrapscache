import { mergeNoteLists } from './model/merge';
import type { Label, Note, NoteImage } from './types';
import { stableStringify } from './model/stableStringify';
import { PendingJournal, type Pending } from './pendingJournal';

/**
 * Fast-boot mirrors, so notes show before IndexedDB answers. IndexedDB remains
 * the durable device store, and the notes mirror may lag it: every boot merges
 * the two.
 */
export const NOTES_MIRROR_KEY = 'scrapscache-notes-mirror';
export const LABELS_MIRROR_KEY = 'scrapscache-labels-mirror';
/**
 * The notes whose IndexedDB write has not landed yet, keyed by id. Written
 * synchronously before each write starts, so an edit survives a crash that
 * comes before the write commits; the next boot replays it.
 */
export const PENDING_NOTES_KEY = 'scrapscache-notes-pending';

function notesMirrorKey(pid: string): string {
	return `${NOTES_MIRROR_KEY}:${pid}`;
}

function labelsMirrorKey(pid: string): string {
	return `${LABELS_MIRROR_KEY}:${pid}`;
}

type MirroredImage = Omit<NoteImage, 'dataUrl' | 'thumbUrl'>;
type MirroredNote = Omit<Note, 'images'> & { images?: MirroredImage[] };

function imageRef(image: NoteImage): MirroredImage {
	const { dataUrl: _bytes, thumbUrl: _thumb, ...meta } = image;
	return {
		...meta,
		id: image.id,
		mime: image.mime,
		createdAt: image.createdAt
	};
}

/** Notes crash mirror: text and attachment ids only. Attachment bytes stay in IndexedDB. */
export function noteForLocalStorage(note: Note): MirroredNote {
	const { images, linkPreviews, ...rest } = note;
	return {
		...rest,
		labels: [...(note.labels ?? [])],
		...(images?.length ? { images: images.map(imageRef) } : {}),
		fieldTimes: note.fieldTimes ? { ...note.fieldTimes } : undefined,
		...(linkPreviews?.length
			? {
					linkPreviews: linkPreviews.map((preview) => ({
						url: preview.url,
						hostname: preview.hostname,
						title: preview.title,
						...(preview.description ? { description: preview.description } : {})
					}))
				}
			: {})
	};
}

function parseArray<T>(raw: string | null): T[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as T[]) : [];
	} catch {
		return [];
	}
}

function readJson<T>(key: string): T[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		return parseArray<T>(localStorage.getItem(key));
	} catch (err) {
		console.error('[storage] read mirror failed:', key, err);
		return [];
	}
}

function writeJson<T>(key: string, value: T[]): boolean {
	if (typeof localStorage === 'undefined') return false;
	try {
		localStorage.setItem(key, JSON.stringify(value));
		return true;
	} catch (err) {
		console.error('[storage] write mirror failed:', key, err);
		return false;
	}
}

function fromMirror(note: MirroredNote): Note {
	const { images, ...rest } = note;
	return {
		...rest,
		images: (images ?? []).map((image) => ({
			...image,
			dataUrl: ''
		}))
	};
}

/** The mirrored notes, with every pending write laid over them. */
export function readNotesMirror(pid: string, journal = readPendingNotes(pid)): Note[] {
	if (!pid) return [];
	const mirrored = readJson<MirroredNote>(notesMirrorKey(pid)).map(fromMirror);
	const pending = Object.values(journal).map(fromMirror);
	return pending.length ? mergeNoteLists(pending, mirrored) : mirrored;
}

/** The fast-boot copy of the notes only makes a start quicker: it goes first when room is short. */
export function dropNotesMirror(pid: string): void {
	localStorage.removeItem(notesMirrorKey(pid));
}

const pendingNotes = new PendingJournal<MirroredNote>(PENDING_NOTES_KEY, dropNotesMirror);

/** Labels whose save has not landed: the label, or the time it was deleted. */
export const pendingLabels = new PendingJournal<Label | number>(
	'scrapscache-labels-pending',
	dropNotesMirror
);

/** Notes being deleted for good whose delete has not landed: the time of the delete. */
export const pendingNoteDeletes = new PendingJournal<number>(
	'scrapscache-note-deletes-pending',
	dropNotesMirror
);

export type PendingNotes = Pending<MirroredNote>;

/** The pending-write journal as stored: one entry per note id. */
export function readPendingNotes(pid: string): PendingNotes {
	return pendingNotes.read(pid);
}

/**
 * Journal notes before their IndexedDB writes start. False when the journal
 * could not be written.
 */
export function journalPendingNotes(notes: Note[], pid: string): boolean {
	return pendingNotes.add(
		pid,
		Object.fromEntries(notes.map((note) => [note.id, noteForLocalStorage(note)]))
	);
}

/** Drop the entries whose writes landed, while they still hold what was written. */
export function settlePendingNotes(landed: PendingNotes, pid: string): void {
	pendingNotes.settle(pid, landed);
}

/** Fallback mirror size when the full write exceeds the localStorage quota. */
export const MIRROR_FALLBACK_LIMIT = 50;

/**
 * Per workspace, the fewest notes whose full mirror did not fit. A mirror of at
 * least as many is not serialized again only to fail; deleting notes lifts it.
 */
const overQuota = new Map<string, number>();

/** True when any mirror write landed; false means the mirror went stale. */
export function writeNotesMirror(notes: Note[], pid: string): boolean {
	if (!pid) return false;
	const key = notesMirrorKey(pid);
	const limit = overQuota.get(pid);
	if (limit === undefined || notes.length < limit) {
		if (writeJson(key, notes.map(noteForLocalStorage))) {
			overQuota.delete(pid);
			return true;
		}
		overQuota.set(pid, Math.min(limit ?? notes.length, notes.length));
	}
	// The full mirror exceeded the quota. Keep the most recent notes for a fast
	// boot instead of letting the mirror go entirely stale.
	const recent = [...notes]
		.sort((left, right) => right.updatedAt - left.updatedAt)
		.slice(0, MIRROR_FALLBACK_LIMIT)
		.map(noteForLocalStorage);
	return writeJson(key, recent);
}

export function readLabelsMirror(pid: string): Label[] {
	if (!pid) return [];
	return readJson<Label>(labelsMirrorKey(pid));
}

export function writeLabelsMirror(labels: Label[], pid: string): void {
	if (!pid) return;
	writeJson(labelsMirrorKey(pid), labels);
}

export function clearNotesMirror(pid: string): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(notesMirrorKey(pid));
		localStorage.removeItem(labelsMirrorKey(pid));
		pendingNotes.clear(pid);
		pendingNoteDeletes.clear(pid);
		pendingLabels.clear(pid);
	} catch {}
}

/** A note as its database row holds it: everything but the bytes and previews of its attachments. */
export function durableNoteSignature(note: Note): string {
	return stableStringify({
		...note,
		images: (note.images ?? []).map(({ dataUrl: _dataUrl, thumbUrl: _thumbUrl, ...image }) => image)
	});
}

/** True when `candidate` differs from the stored `current`, or brings bytes it has none of. */
export function noteNeedsDurableWrite(current: Note | undefined, candidate: Note): boolean {
	if (!current || durableNoteSignature(current) !== durableNoteSignature(candidate)) return true;
	const currentImages = new Map((current.images ?? []).map((image) => [image.id, image]));
	return (candidate.images ?? []).some((image) => {
		const previous = currentImages.get(image.id);
		return (
			image.dataUrl.length > 0 && (!previous || (!previous.dataUrl.length && !previous.thumbUrl))
		);
	});
}
