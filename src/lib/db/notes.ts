// Notes and the bytes of their attachments, in a workspace's database.

import { type IDBPDatabase } from 'idb';
import { copyImage, copyNote, mergeTwoNotes } from '#lib/model/index.js';
import type { Note, NoteImage } from '#lib/types.js';
import { blobToDataUrl, dataUrlToBlob } from '#lib/imageBlob.js';
import { sha256 } from '#lib/syncHash.js';
import { NOTES_STORE, resolveDbName, SYNC_STATE_STORE } from './names.js';

import {
	IMAGES_STORE,
	IMAGE_VERSION_INDEX,
	SYNC_OUTBOX_STORE,
	enqueueDeviceWrite,
	enqueueNote,
	getDB,
	outboxGenerations
} from './connection.js';
import { abortWrite, nextOutboxGeneration, uniqueOutboxKeys } from './outbox.js';

/** Plain clone — never hand Svelte proxies to IndexedDB. */
function plainNote(note: Note): Note {
	return copyNote(note);
}

/** Plain, validated data only: never hand Svelte proxies to IndexedDB.
 *  Image bytes live in IMAGES_STORE — note rows keep empty dataUrl placeholders + thumbs. */
export function detachNote(note: Note): Note {
	const plain = plainNote(note);
	return {
		...plain,
		images: (plain.images ?? []).map((image) => ({
			...image,
			dataUrl: '',
			...(image.thumbUrl ? { thumbUrl: image.thumbUrl } : {})
		}))
	};
}

/**
 * Attachment rows are written by `writeNote` and `rewriteWorkspace`. `hash` is the
 * version the bytes are: the content hash a note names its attachment by. A row from
 * before rows carried one is given it the first time it is read or listed.
 */
type StoredImage = { mime: string; bytes: Uint8Array; hash?: string };

/** The bytes of a stored image row, or null when the row is missing or malformed.
 * `isView` rather than `instanceof`: a structured clone may come from another realm. */
export function storedImageBytes(value: unknown): Uint8Array | null {
	if (!value || typeof value !== 'object') return null;
	const { mime, bytes } = value as Partial<StoredImage>;
	if (typeof mime !== 'string' || !ArrayBuffer.isView(bytes)) return null;
	return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** A stored row's bytes as the data URL a note carries, with the version they are. */
async function readStoredImage(
	db: IDBPDatabase,
	key: string
): Promise<{ dataUrl: string; mime: string; hash: string } | null> {
	const stored: unknown = await db.get(IMAGES_STORE, key);
	const bytes = storedImageBytes(stored);
	if (!bytes) return null;
	const { mime, hash } = stored as StoredImage;
	const dataUrl = await blobToDataUrl(new Blob([bytes.slice()], { type: mime }));
	if (typeof hash === 'string') return { dataUrl, mime, hash };
	const version = await sha256(dataUrl);
	// Every write since rows carry a version brings one, so a row still without
	// one is the row that was just read.
	const tx = db.transaction(IMAGES_STORE, 'readwrite');
	const current = (await tx.store.get(key)) as StoredImage | undefined;
	if (current && current.hash === undefined) await tx.store.put({ ...current, hash: version }, key);
	await tx.done;
	return { dataUrl, mime, hash: version };
}

/**
 * An attachment with the bytes this device holds for it. Bytes of another version
 * than the one the note names are not this attachment: it comes back without any.
 */
async function imageFromStoredValue(
	db: IDBPDatabase,
	noteId: string,
	meta: NoteImage
): Promise<NoteImage | null> {
	if (meta.dataUrl?.length > 20) return copyImage(meta);
	const stored = await readStoredImage(db, `${noteId}::${meta.id}`);
	if (!stored || (meta.contentHash && meta.contentHash !== stored.hash)) {
		return copyImage({ ...meta, dataUrl: '' });
	}
	return copyImage({
		...meta,
		mime: meta.mime || stored.mime,
		dataUrl: stored.dataUrl,
		contentHash: stored.hash
	});
}

async function hydrateNoteImages(db: IDBPDatabase, note: Note): Promise<Note> {
	const images: Array<NoteImage | null> = [];
	for (const meta of note.images ?? []) {
		images.push(await imageFromStoredValue(db, note.id, meta));
	}
	return {
		...plainNote(note),
		images: images.filter((image): image is NoteImage => image !== null)
	};
}

export type ImageRow = { key: string; value: StoredImage };

/** An attachment's bytes as its row holds them. Decoded before a transaction opens: awaiting anything but a request inside one commits it. */
export async function imageRow(noteId: string, image: NoteImage): Promise<ImageRow> {
	const blob = await dataUrlToBlob(image.dataUrl);
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const hash = image.contentHash ?? (await sha256(image.dataUrl));
	return { key: `${noteId}::${image.id}`, value: { mime: blob.type, bytes, hash } };
}

/** The keys of every attachment row of one note. */
export function imageKeysOf(noteId: string): IDBKeyRange {
	return IDBKeyRange.bound(`${noteId}::`, `${noteId}::\uffff`);
}

/**
 * Write one note as `decide` makes it from the copy stored at that moment; null
 * writes nothing. The read, the note, its attachment bytes and its upload markers
 * are one transaction, so nothing another window saves can land between the copy
 * that was read and the one written, and a tab killed part-way leaves the note as
 * it was. `candidate` is the copy whose bytes may be written: an attachment the
 * stored copy wins is left with the bytes it has.
 */
async function writeNote(
	pid: string,
	candidate: Note,
	decide: (stored: Note | undefined) => Note | null,
	syncOutboxKeys: string[]
): Promise<Note | null> {
	const db = await getDB(pid);
	const id = candidate.id;
	const rows = new Map<string, { dataUrl: string; row: ImageRow }>();
	for (const image of candidate.images ?? []) {
		if (image.dataUrl)
			rows.set(image.id, { dataUrl: image.dataUrl, row: await imageRow(id, image) });
	}
	const dbName = resolveDbName(pid);
	const previousGeneration = outboxGenerations.get(dbName) ?? null;
	const tx = db.transaction(
		syncOutboxKeys.length
			? [NOTES_STORE, IMAGES_STORE, SYNC_STATE_STORE, SYNC_OUTBOX_STORE]
			: [NOTES_STORE, IMAGES_STORE],
		'readwrite'
	);
	try {
		const notes = tx.objectStore(NOTES_STORE);
		const images = tx.objectStore(IMAGES_STORE);
		const stored = (await notes.get(id)) as Note | undefined;
		const decided = decide(stored ? plainNote(stored) : undefined);
		if (!decided) {
			await tx.done;
			return null;
		}
		const note = plainNote(decided);
		let wroteBytes = false;
		for (const image of note.images ?? []) {
			const held = rows.get(image.id);
			if (!image.dataUrl || held?.dataUrl !== image.dataUrl) continue;
			await images.put(held.row.value, held.row.key);
			wroteBytes = true;
		}
		const listed = new Set((note.images ?? []).map((image) => `${id}::${image.id}`));
		if (wroteBytes || listed.size === 0) {
			for (const key of (await images.getAllKeys(imageKeysOf(id))) as string[]) {
				if (!listed.has(key)) await images.delete(key);
			}
		}
		await notes.put(detachNote(note));
		if (syncOutboxKeys.length) {
			const generation = await nextOutboxGeneration(tx, dbName);
			const outbox = tx.objectStore(SYNC_OUTBOX_STORE);
			for (const key of syncOutboxKeys) await outbox.put(generation, key);
		}
		await tx.done;
		return note;
	} catch (error) {
		await abortWrite(tx, dbName, previousGeneration);
		throw error;
	}
}

export async function getAllNotesMetadata(pid: string): Promise<Note[]> {
	const db = await getDB(pid);
	return ((await db.getAll(NOTES_STORE)) as Note[]).map(plainNote);
}

export async function getNote(pid: string, id: string): Promise<Note | undefined> {
	const db = await getDB(pid);
	const stored = (await db.get(NOTES_STORE, id)) as Note | undefined;
	if (!stored) return undefined;
	return plainNote(stored);
}

export async function pruneOrphanImageBlobs(pid: string): Promise<void> {
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		// One transaction: bytes another window saves meanwhile, with the note that
		// lists them, are either both seen here or both land after.
		const tx = db.transaction([NOTES_STORE, IMAGES_STORE], 'readwrite');
		const images = tx.objectStore(IMAGES_STORE);
		const notes = (await tx.objectStore(NOTES_STORE).getAll()) as Note[];
		const referenced = new Set<string>();
		for (const note of notes) {
			for (const image of note.images ?? []) referenced.add(`${note.id}::${image.id}`);
		}
		for (const key of (await images.getAllKeys()) as string[]) {
			if (!referenced.has(key)) await images.delete(key);
		}
		await tx.done;
	});
}

/** Held by every window, together, while a write of attachment bytes is on its way. */
export function attachmentWritesLock(pid: string): string {
	return `scrapscache-attachment-writes:${resolveDbName(pid)}`;
}

/**
 * Hold that lock from now until the function returned is called. A window asks for
 * it before it makes a note list new bytes anywhere another window can read, and
 * lets go once the bytes are stored: no window then takes them for absent.
 */
export function holdAttachmentWrites(pid: string): () => void {
	let release!: () => void;
	const held = new Promise<void>((resolve) => (release = resolve));
	void withAttachmentWritesLock(pid, 'shared', () => held).catch(() => undefined);
	return release;
}

function withAttachmentWritesLock<T>(
	pid: string,
	mode: 'shared' | 'exclusive',
	run: () => Promise<T>,
	signal?: AbortSignal
): Promise<T> {
	const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
	if (!locks?.request) return run();
	return locks.request(
		attachmentWritesLock(pid),
		{ mode, ...(signal ? { signal } : {}) },
		run
	) as Promise<T>;
}

/**
 * Which version of each attachment this device holds bytes for, keyed
 * `${noteId}::${attachmentId}`. Read from the version index, so no bytes are loaded;
 * rows that carry no version yet are read once to give them one.
 *
 * What is absent here is decided on, so the answer waits for every write of bytes
 * that has begun, in this window or another, to land. A window that went away
 * mid-write no longer holds the lock, and its bytes are not coming.
 */
export function getStoredAttachmentVersions(
	pid: string,
	signal?: AbortSignal
): Promise<Map<string, string>> {
	return withAttachmentWritesLock(
		pid,
		'exclusive',
		() => readStoredAttachmentVersions(pid),
		signal
	);
}

async function readStoredAttachmentVersions(pid: string): Promise<Map<string, string>> {
	const db = await getDB(pid);
	const listVersions = async () => {
		const versions = new Map<string, string>();
		let cursor = await db
			.transaction(IMAGES_STORE)
			.store.index(IMAGE_VERSION_INDEX)
			.openKeyCursor();
		while (cursor) {
			versions.set(String(cursor.primaryKey), String(cursor.key));
			cursor = await cursor.continue();
		}
		return versions;
	};
	const versions = await listVersions();
	const unversioned = ((await db.getAllKeys(IMAGES_STORE)) as string[]).filter(
		(key) => !versions.has(key)
	);
	if (unversioned.length === 0) return versions;
	for (const key of unversioned) await readStoredImage(db, key);
	return listVersions();
}

export async function hydrateNoteAttachments(pid: string, note: Note): Promise<Note> {
	const db = await getDB(pid);
	return hydrateNoteImages(db, note);
}

/**
 * Write a note exactly as given, over what is stored: a first copy. Anything that
 * changes a note that may be stored is saved with `saveNote` or `mergeNote`.
 */
export async function putNote(pid: string, note: Note, keys: Iterable<string> = []): Promise<void> {
	const snapshot = plainNote(note);
	const outboxKeys = uniqueOutboxKeys(keys);
	await enqueueNote(pid, snapshot.id, () =>
		enqueueDeviceWrite(() => writeNote(pid, snapshot, () => snapshot, outboxKeys))
	);
}

/**
 * Save a note as `merge` makes it from the copy stored at that moment, queued to
 * upload under `keys` in the same transaction; null saves nothing. `note` is the
 * copy being brought in, whose bytes are written where the result keeps them. It
 * takes its turn among this window's saves of that note, and reads and writes in
 * one transaction, so a save from any window is either what `merge` is given or
 * lands after it.
 */
export function mergeNote(
	pid: string,
	note: Note,
	merge: (stored: Note | undefined) => Note | null,
	keys: Iterable<string> = []
): Promise<Note | null> {
	const candidate = plainNote(note);
	const outboxKeys = uniqueOutboxKeys(keys);
	return enqueueNote(pid, candidate.id, () =>
		enqueueDeviceWrite(() => writeNote(pid, candidate, merge, outboxKeys))
	);
}

/**
 * Save an edited note: merged with the copy stored at that moment, never over it.
 * The database only moves forward, so whatever else saved the note meanwhile (a
 * sync, another window) is kept, whichever of the two lands first.
 */
export async function saveNote(
	pid: string,
	note: Note,
	keys: Iterable<string> = []
): Promise<void> {
	const snapshot = plainNote(note);
	await mergeNote(
		pid,
		snapshot,
		(stored) => (stored ? mergeTwoNotes(stored, snapshot) : snapshot),
		keys
	);
}

/** Both arguments are named: two strings are too easy to read the wrong way round. */
export function deleteNote(pid: string, id: string): Promise<void> {
	return enqueueNote(pid, id, async () => {
		await enqueueDeviceWrite(async () => {
			const db = await getDB(pid);
			const tx = db.transaction([NOTES_STORE, IMAGES_STORE], 'readwrite');
			tx.objectStore(NOTES_STORE).delete(id);
			tx.objectStore(IMAGES_STORE).delete(imageKeysOf(id));
			await tx.done;
		});
	});
}

// --- Labels API -------------------------------------------------------------

export async function bulkPutNotes(pid: string, notes: Note[]): Promise<void> {
	for (const note of notes) {
		await putNote(pid, note);
	}
}
