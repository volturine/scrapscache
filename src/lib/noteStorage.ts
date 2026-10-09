import { mergeNoteLists } from './model/merge';
import type { Label, Note, NoteImage } from './types';

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

function pendingNotesKey(pid: string): string {
	return `${PENDING_NOTES_KEY}:${pid}`;
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

export type PendingNotes = Record<string, MirroredNote>;

/** The pending-write journal as stored: one entry per note id. */
export function readPendingNotes(pid: string): PendingNotes {
	if (!pid || typeof localStorage === 'undefined') return {};
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(pendingNotesKey(pid)) ?? '{}');
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as PendingNotes)
			: {};
	} catch (err) {
		console.error('[storage] read pending notes failed:', err);
		return {};
	}
}

function writePendingNotes(pid: string, entries: PendingNotes): boolean {
	if (typeof localStorage === 'undefined') return false;
	const key = pendingNotesKey(pid);
	try {
		if (Object.keys(entries).length) localStorage.setItem(key, JSON.stringify(entries));
		else localStorage.removeItem(key);
		return true;
	} catch (err) {
		console.error('[storage] write pending notes failed:', err);
		return false;
	}
}

/**
 * Journal notes before their IndexedDB writes start. Read, changed and written
 * back, so the entries another window of the same workspace journaled stay.
 * False when the journal could not be written.
 */
export function journalPendingNotes(notes: Note[], pid: string): boolean {
	if (!pid) return false;
	if (notes.length === 0) return true;
	const entries = readPendingNotes(pid);
	for (const note of notes) entries[note.id] = noteForLocalStorage(note);
	if (writePendingNotes(pid, entries)) return true;
	// The fast-boot mirror can fill the quota. Unsaved edits come first: drop the
	// mirror, which only costs the next boot a moment, and journal again.
	try {
		localStorage.removeItem(notesMirrorKey(pid));
	} catch {
		return false;
	}
	return writePendingNotes(pid, entries);
}

/**
 * Drop the entries whose writes landed. An entry only goes when it still holds
 * what was written: a later edit, from this window or another, journaled its
 * own copy and keeps it until its own write lands.
 */
export function settlePendingNotes(landed: PendingNotes, pid: string): void {
	if (!pid) return;
	const entries = readPendingNotes(pid);
	let changed = false;
	for (const [id, written] of Object.entries(landed)) {
		const entry = entries[id];
		if (entry && JSON.stringify(entry) === JSON.stringify(written)) {
			delete entries[id];
			changed = true;
		}
	}
	if (changed) writePendingNotes(pid, entries);
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
		localStorage.removeItem(pendingNotesKey(pid));
		localStorage.removeItem(labelsMirrorKey(pid));
	} catch {}
}
