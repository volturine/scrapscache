// Device persistence. IndexedDB is the durable source of truth; localStorage is handled
// separately as a blob-free fast-boot mirror by noteStorage.ts.
// Each profile has its own isolated IndexedDB database, keeping the schema,
// stores, and DB version (v6) identical to master with zero migrations.

import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type { LinkPreview } from '$lib/linkPreview';
import type { Label, Note, NoteImage } from '$lib/types';
import type { KanbanBoard } from '$lib/kanban';
import { blobToDataUrl, dataUrlToBlob } from '$lib/imageBlob';

const DB_NAME = 'scrapscache';
const DB_VERSION = 6;
export const NOTES_STORE = 'notes';
export const LABELS_STORE = 'labels';
export const IMAGES_STORE = 'note-images';
const LINK_PREVIEWS_STORE = 'link-previews';
const SYNC_STATE_STORE = 'sync-state';
export const SYNC_OUTBOX_STORE = 'sync-outbox';

/** Namespace for notes created before any sync key exists. */
export const LOCAL_PROFILE_ID = 'device-local';

/** One saved sync key ("profile") on this device. */
export interface StoredProfile {
	id: string;
	name: string;
	syncKey: string;
	createdAt: number;
}

const LS_PROFILES = 'scrapscache-sync-profiles';
const LS_PROFILES_LEGACY = 'gkc-sync-profiles';

const dbPromises = new Map<string, Promise<IDBPDatabase>>();
const noteChains = new Map<string, Promise<void>>();
let deviceWriteChain: Promise<void> = Promise.resolve();
let writeGeneration = 0;
const outboxGenerations = new Map<string, number>();

function enqueueDeviceWrite<T>(operation: () => Promise<T>): Promise<T> {
	const run = deviceWriteChain.catch(() => undefined).then(operation);
	deviceWriteChain = run.then(
		() => undefined,
		() => undefined
	);
	return run;
}

export const DEVICE_DB_NAME = DB_NAME;

/** Each profile owns its own database; the no-key namespace keeps the device name. */
export function resolveDbName(pid?: string): string {
	if (!pid || pid === LOCAL_PROFILE_ID) return DEVICE_DB_NAME;
	return `${DEVICE_DB_NAME}-profile-${pid}`;
}

export function scopedStateKey(base: string, pid?: string): string {
	return pid && pid !== LOCAL_PROFILE_ID ? `${base}:${pid}` : base;
}

const KANBAN_BOARDS_STATE_KEY = 'scrapscache-idb-kanban-boards';

const SCOPED_STATE_PREFIXES = [
	'scrapscache-idb-note-tombstones',
	'scrapscache-idb-label-tombstones',
	'scrapscache-idb-board-tombstones',
	KANBAN_BOARDS_STATE_KEY,
	'scrapscache-fired-reminders'
];

function extractPidFromStateKey(key: string): { pid: string; baseKey: string } {
	for (const prefix of SCOPED_STATE_PREFIXES) {
		if (key.startsWith(prefix + ':')) {
			return {
				pid: key.slice(prefix.length + 1),
				baseKey: prefix
			};
		}
	}
	return { pid: LOCAL_PROFILE_ID, baseKey: key };
}

export function getDB(pid?: string): Promise<IDBPDatabase> {
	if (typeof indexedDB === 'undefined') {
		return Promise.reject(new Error('IndexedDB is not available'));
	}
	const dbName = resolveDbName(pid);
	let promise = dbPromises.get(dbName);
	if (!promise) {
		promise = openDB(dbName, DB_VERSION, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(NOTES_STORE)) {
					db.createObjectStore(NOTES_STORE, { keyPath: 'id' });
				}
				if (!db.objectStoreNames.contains(LABELS_STORE)) {
					db.createObjectStore(LABELS_STORE, { keyPath: 'id' });
				}
				if (!db.objectStoreNames.contains(IMAGES_STORE)) {
					db.createObjectStore(IMAGES_STORE);
				}
				if (!db.objectStoreNames.contains(LINK_PREVIEWS_STORE)) {
					db.createObjectStore(LINK_PREVIEWS_STORE, { keyPath: 'url' });
				}
				if (!db.objectStoreNames.contains(SYNC_STATE_STORE)) {
					db.createObjectStore(SYNC_STATE_STORE);
				}
				if (!db.objectStoreNames.contains(SYNC_OUTBOX_STORE)) {
					db.createObjectStore(SYNC_OUTBOX_STORE);
				}
			}
		});
		dbPromises.set(dbName, promise);
	}
	return promise;
}

/** Drop the cached connections so tests can delete the database between cases. */
export function closeDeviceDatabase(): void {
	const existing = Array.from(dbPromises.values());
	dbPromises.clear();
	deviceWriteChain = Promise.resolve();
	noteChains.clear();
	writeGeneration = 0;
	outboxGenerations.clear();
	for (const p of existing) {
		void p.then(
			(db) => {
				try {
					db.close();
				} catch {}
			},
			() => undefined
		);
	}
}

/** Wait until all note and device writes queued in this window have settled. */
export async function waitForDeviceWrites(pid?: string): Promise<void> {
	const prefix = pid ? `${pid}::` : null;
	while (true) {
		const device = deviceWriteChain;
		const notes = [...noteChains.entries()]
			.filter(([key]) => prefix === null || key.startsWith(prefix))
			.map(([, pending]) => pending);
		await Promise.all([device, ...notes]);
		const stillPending = [...noteChains.keys()].some(
			(key) => prefix === null || key.startsWith(prefix)
		);
		if (device === deviceWriteChain && !stillPending) return;
	}
}

/** Plain clone of an attachment — never hand Svelte proxies to IndexedDB. */
function plainImage(image: NoteImage): NoteImage {
	return {
		id: String(image.id),
		mime: String(image.mime || 'application/octet-stream'),
		dataUrl: typeof image.dataUrl === 'string' ? image.dataUrl : '',
		createdAt: Number(image.createdAt) || 0,
		...(image.name != null && image.name !== '' ? { name: String(image.name) } : {}),
		...(typeof image.thumbUrl === 'string' && image.thumbUrl
			? { thumbUrl: String(image.thumbUrl) }
			: {}),
		...(Number.isFinite(image.width) ? { width: Number(image.width) } : {}),
		...(Number.isFinite(image.height) ? { height: Number(image.height) } : {}),
		...(Number.isFinite(image.byteSize) ? { byteSize: Number(image.byteSize) } : {}),
		...(typeof image.contentHash === 'string' && image.contentHash
			? { contentHash: String(image.contentHash) }
			: {}),
		...(Number.isFinite(image.encodingVersion)
			? { encodingVersion: Number(image.encodingVersion) }
			: {})
	};
}

function plainLinkPreview(preview: LinkPreview): LinkPreview {
	return {
		url: String(preview.url),
		hostname: String(preview.hostname),
		title: String(preview.title),
		...(preview.description ? { description: String(preview.description) } : {}),
		...(preview.image ? { image: String(preview.image) } : {}),
		...(preview.icon ? { icon: String(preview.icon) } : {})
	};
}

function plainNote(note: Note): Note {
	const images = (note.images ?? []).map(plainImage);
	const linkPreviews = (note.linkPreviews ?? []).map(plainLinkPreview);
	return {
		id: String(note.id),
		title: String(note.title ?? ''),
		body: String(note.body ?? ''),
		color: note.color,
		pinned: Boolean(note.pinned),
		archived: Boolean(note.archived),
		trashed: Boolean(note.trashed),
		trashedAt: note.trashedAt == null ? null : Number(note.trashedAt),
		createdAt: Number(note.createdAt) || 0,
		updatedAt: Number(note.updatedAt) || 0,
		reminder: note.reminder == null ? null : Number(note.reminder),
		labels: Array.from(note.labels ?? [], (id) => String(id)),
		images,
		...(note.fieldTimes ? { fieldTimes: { ...note.fieldTimes } } : {}),
		...(linkPreviews.length ? { linkPreviews } : {})
	};
}

function plainLabel(label: Label): Label {
	return {
		id: String(label.id),
		name: String(label.name),
		createdAt: Number(label.createdAt) || 0,
		updatedAt: Number(label.updatedAt) || Number(label.createdAt) || 0
	};
}

/** Plain, validated data only: never hand Svelte proxies to IndexedDB.
 *  Image bytes live in IMAGES_STORE — note rows keep empty dataUrl placeholders + thumbs. */
function detachNote(note: Note): Note {
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

function bytesFromStored(value: unknown): Uint8Array | null {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
		return Uint8Array.from(value);
	}
	return null;
}

async function blobFromStored(stored: unknown): Promise<Blob | null> {
	if (stored instanceof Blob) return stored;
	if (!stored || typeof stored !== 'object') return null;
	const record = stored as {
		mime?: unknown;
		type?: unknown;
		bytes?: unknown;
		buffer?: unknown;
		dataUrl?: unknown;
		blob?: unknown;
	};
	if (record.blob instanceof Blob) return record.blob;
	const bytes = bytesFromStored(record.bytes) ?? bytesFromStored(record.buffer);
	if (bytes) {
		const type =
			typeof record.mime === 'string'
				? record.mime
				: typeof record.type === 'string'
					? record.type
					: 'application/octet-stream';
		return new Blob([bytes.slice()], { type });
	}
	if (typeof record.dataUrl === 'string' && record.dataUrl) {
		try {
			return await dataUrlToBlob(record.dataUrl);
		} catch {
			return null;
		}
	}
	return null;
}

async function imageFromStoredValue(
	db: IDBPDatabase,
	noteId: string,
	meta: NoteImage
): Promise<NoteImage | null> {
	if (meta.dataUrl?.length > 20) return plainImage(meta);
	const blob =
		(await blobFromStored(await db.get(IMAGES_STORE, `${noteId}::${meta.id}`))) ??
		(await blobFromStored(await db.get(IMAGES_STORE, `${noteId}:${meta.id}`)));
	if (!blob) {
		return plainImage({ ...meta, dataUrl: '' });
	}
	return plainImage({
		...meta,
		mime: meta.mime || blob.type,
		dataUrl: await blobToDataUrl(blob)
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

async function putImageBlobs(pid: string, note: Note): Promise<void> {
	const db = await getDB(pid);
	for (const image of note.images ?? []) {
		if (!image.dataUrl) continue;
		const blob = await dataUrlToBlob(image.dataUrl);
		const bytes = new Uint8Array(await blob.arrayBuffer());
		await db.put(IMAGES_STORE, { mime: blob.type, bytes }, `${note.id}::${image.id}`);
	}
}

async function putNoteSnapshot(
	pid: string,
	note: Note,
	syncOutboxKeys: string[] = []
): Promise<void> {
	const db = await getDB(pid);
	await putImageBlobs(pid, note);
	const dbName = resolveDbName(pid);
	const previousGeneration = outboxGenerations.get(dbName) ?? null;
	const ownPrefix = `${note.id}::`;
	const existingKeys = ((await db.getAllKeys(IMAGES_STORE)) as string[]).filter((key) =>
		key.startsWith(ownPrefix)
	);
	const desiredKeys = new Set((note.images ?? []).map((image) => `${note.id}::${image.id}`));
	const lean = detachNote(note);
	const stores = syncOutboxKeys.length
		? [NOTES_STORE, IMAGES_STORE, SYNC_STATE_STORE, SYNC_OUTBOX_STORE]
		: [NOTES_STORE, IMAGES_STORE];
	const tx = db.transaction(stores, 'readwrite');
	try {
		const incomingHasBytes = (note.images ?? []).some((image) => image.dataUrl);
		if (incomingHasBytes || desiredKeys.size === 0) {
			for (const key of existingKeys) {
				if (!desiredKeys.has(key)) await tx.objectStore(IMAGES_STORE).delete(key);
			}
		}
		await tx.objectStore(NOTES_STORE).put(lean);
		if (syncOutboxKeys.length) {
			const generation = await nextOutboxGeneration(tx, dbName);
			const outbox = tx.objectStore(SYNC_OUTBOX_STORE);
			for (const key of syncOutboxKeys) await outbox.put(generation, key);
		}
		await tx.done;
	} catch (error) {
		await abortWrite(tx, dbName, previousGeneration);
		throw error;
	}
}

function enqueueNote<T>(pid: string, noteId: string, operation: () => Promise<T>): Promise<T> {
	const chainKey = `${pid}::${noteId}`;
	const previous = noteChains.get(chainKey) ?? Promise.resolve();
	const run = previous.catch(() => undefined).then(operation);
	const completion = run.then(
		() => undefined,
		() => undefined
	);
	noteChains.set(chainKey, completion);
	return run.finally(() => {
		if (noteChains.get(chainKey) === completion) noteChains.delete(chainKey);
	});
}

// --- Notes API --------------------------------------------------------------

export async function getAllNotesMetadata(pid: string = LOCAL_PROFILE_ID): Promise<Note[]> {
	const db = await getDB(pid);
	return ((await db.getAll(NOTES_STORE)) as Note[]).map(plainNote);
}

export async function getNote(
	id: string,
	pid: string = LOCAL_PROFILE_ID
): Promise<Note | undefined> {
	const db = await getDB(pid);
	const stored = (await db.get(NOTES_STORE, id)) as Note | undefined;
	if (!stored) return undefined;
	return plainNote(stored);
}

export async function pruneOrphanImageBlobs(pid: string = LOCAL_PROFILE_ID): Promise<void> {
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const notes = (await db.getAll(NOTES_STORE)) as Note[];
		const referenced = new Set<string>();
		for (const note of notes) {
			for (const image of note.images ?? []) {
				referenced.add(`${note.id}::${image.id}`);
			}
		}
		const storedKeys = (await db.getAllKeys(IMAGES_STORE)) as string[];
		const orphans = storedKeys.filter((key) => !referenced.has(key));
		if (orphans.length === 0) return;
		const tx = db.transaction(IMAGES_STORE, 'readwrite');
		for (const key of orphans) void tx.objectStore(IMAGES_STORE).delete(key);
		await tx.done;
	});
}

export async function hydrateNoteAttachments(
	pidOrNote: string | Note,
	maybeNote?: Note
): Promise<Note> {
	const pid = typeof pidOrNote === 'string' ? pidOrNote : LOCAL_PROFILE_ID;
	const note = typeof pidOrNote === 'string' ? maybeNote! : pidOrNote;
	const db = await getDB(pid);
	return hydrateNoteImages(db, note);
}

export async function putNote(
	pidOrNote: string | Note,
	noteOrKeys?: Note | Iterable<string>,
	maybeKeys?: Iterable<string>
): Promise<void> {
	const pid = typeof pidOrNote === 'string' ? pidOrNote : LOCAL_PROFILE_ID;
	const note = typeof pidOrNote === 'string' ? (noteOrKeys as Note) : pidOrNote;
	const keys =
		typeof pidOrNote === 'string' ? (maybeKeys ?? []) : ((noteOrKeys as Iterable<string>) ?? []);
	const snapshot = plainNote(note);
	const outboxKeys = uniqueOutboxKeys(keys);
	const generation = writeGeneration;
	return enqueueNote(pid, snapshot.id, () =>
		enqueueDeviceWrite(async () => {
			if (generation !== writeGeneration) return;
			await putNoteSnapshot(pid, snapshot, outboxKeys);
		})
	);
}

/** Both arguments are named: two strings are too easy to read the wrong way round. */
export function deleteNote(pid: string, id: string): Promise<void> {
	const generation = writeGeneration;
	return enqueueNote(pid, id, async () => {
		await enqueueDeviceWrite(async () => {
			if (generation !== writeGeneration) return;
			const db = await getDB(pid);
			const ownPrefix = `${id}::`;
			const imageKeys = ((await db.getAllKeys(IMAGES_STORE)) as string[]).filter((key) =>
				key.startsWith(ownPrefix)
			);
			const tx = db.transaction([NOTES_STORE, IMAGES_STORE], 'readwrite');
			tx.objectStore(NOTES_STORE).delete(id);
			for (const key of imageKeys) tx.objectStore(IMAGES_STORE).delete(key);
			await tx.done;
		});
	});
}

// --- Labels API -------------------------------------------------------------

export async function getAllLabels(pid: string = LOCAL_PROFILE_ID): Promise<Label[]> {
	const db = await getDB(pid);
	return ((await db.getAll(LABELS_STORE)) as Label[]).map(plainLabel);
}

export async function putLabel(
	pidOrLabel: string | Label,
	labelOrKeys?: Label | Iterable<string>,
	maybeKeys?: Iterable<string>
): Promise<void> {
	const pid = typeof pidOrLabel === 'string' ? pidOrLabel : LOCAL_PROFILE_ID;
	const label = typeof pidOrLabel === 'string' ? (labelOrKeys as Label) : pidOrLabel;
	const syncOutboxKeys =
		typeof pidOrLabel === 'string' ? (maybeKeys ?? []) : ((labelOrKeys as Iterable<string>) ?? []);
	const outboxKeys = uniqueOutboxKeys(syncOutboxKeys);
	const lean = plainLabel(label);
	const dbName = resolveDbName(pid);
	const previousGeneration = outboxGenerations.get(dbName) ?? null;
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const tx = db.transaction(
			outboxKeys.length ? [LABELS_STORE, SYNC_STATE_STORE, SYNC_OUTBOX_STORE] : [LABELS_STORE],
			'readwrite'
		);
		try {
			await tx.objectStore(LABELS_STORE).put(lean);
			if (outboxKeys.length) {
				const generation = await nextOutboxGeneration(tx, dbName);
				const outbox = tx.objectStore(SYNC_OUTBOX_STORE);
				for (const key of outboxKeys) await outbox.put(generation, key);
			}
			await tx.done;
		} catch (error) {
			await abortWrite(tx, dbName, previousGeneration);
			throw error;
		}
	});
}

export async function deleteLabel(
	pid: string,
	id: string,
	maybeKeys?: Iterable<string>
): Promise<void> {
	const syncOutboxKeys = maybeKeys ?? [];
	const outboxKeys = uniqueOutboxKeys(syncOutboxKeys);
	const dbName = resolveDbName(pid);
	const previousGeneration = outboxGenerations.get(dbName) ?? null;
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const tx = db.transaction(
			outboxKeys.length ? [LABELS_STORE, SYNC_STATE_STORE, SYNC_OUTBOX_STORE] : [LABELS_STORE],
			'readwrite'
		);
		try {
			await tx.objectStore(LABELS_STORE).delete(id);
			if (outboxKeys.length) {
				const generation = await nextOutboxGeneration(tx, dbName);
				const outbox = tx.objectStore(SYNC_OUTBOX_STORE);
				for (const key of outboxKeys) await outbox.put(generation, key);
			}
			await tx.done;
		} catch (error) {
			await abortWrite(tx, dbName, previousGeneration);
			throw error;
		}
	});
}

export async function deleteLabelWithSyncState(
	pidOrId: string,
	idOrState: string | Iterable<readonly [key: string, value: unknown]>,
	stateOrKeys?: Iterable<readonly [key: string, value: unknown]> | Iterable<string>,
	maybeKeys?: Iterable<string>
): Promise<void> {
	const isScoped = typeof idOrState === 'string';
	const pid = isScoped ? pidOrId : LOCAL_PROFILE_ID;
	const id = isScoped ? idOrState : pidOrId;
	const state = isScoped
		? (stateOrKeys as Iterable<readonly [key: string, value: unknown]>)
		: (idOrState as Iterable<readonly [key: string, value: unknown]>);
	const syncOutboxKeys = isScoped ? (maybeKeys ?? []) : ((stateOrKeys as Iterable<string>) ?? []);
	const outboxKeys = uniqueOutboxKeys(syncOutboxKeys);
	const entries = [...state];
	const dbName = resolveDbName(pid);
	const previousGeneration = outboxGenerations.get(dbName) ?? null;
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const tx = db.transaction(
			outboxKeys.length
				? [LABELS_STORE, SYNC_STATE_STORE, SYNC_OUTBOX_STORE]
				: [LABELS_STORE, SYNC_STATE_STORE],
			'readwrite'
		);
		try {
			await tx.objectStore(LABELS_STORE).delete(id);
			const syncState = tx.objectStore(SYNC_STATE_STORE);
			for (const [key, value] of entries) await syncState.put(value, scopedStateKey(key, pid));
			if (outboxKeys.length) {
				const generation = await nextOutboxGeneration(tx, dbName);
				const outbox = tx.objectStore(SYNC_OUTBOX_STORE);
				for (const key of outboxKeys) await outbox.put(generation, key);
			}
			await tx.done;
		} catch (error) {
			await abortWrite(tx, dbName, previousGeneration);
			throw error;
		}
	});
}

export async function writeSyncStateWithOutbox(
	pidOrState: string | Iterable<readonly [key: string, value: unknown]>,
	stateOrKeys?: Iterable<readonly [key: string, value: unknown]> | Iterable<string>,
	maybeKeys?: Iterable<string>
): Promise<void> {
	const isScoped = typeof pidOrState === 'string';
	const pid = isScoped ? pidOrState : LOCAL_PROFILE_ID;
	const state = isScoped
		? (stateOrKeys as Iterable<readonly [key: string, value: unknown]>)
		: (pidOrState as Iterable<readonly [key: string, value: unknown]>);
	const syncOutboxKeys = isScoped ? (maybeKeys ?? []) : ((stateOrKeys as Iterable<string>) ?? []);
	const entries = [...state];
	const outboxKeys = uniqueOutboxKeys(syncOutboxKeys);
	const dbName = resolveDbName(pid);
	const previousGeneration = outboxGenerations.get(dbName) ?? null;
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const tx = db.transaction(
			outboxKeys.length ? [SYNC_STATE_STORE, SYNC_OUTBOX_STORE] : [SYNC_STATE_STORE],
			'readwrite'
		);
		try {
			const store = tx.objectStore(SYNC_STATE_STORE);
			for (const [key, value] of entries) await store.put(value, scopedStateKey(key, pid));
			if (outboxKeys.length) {
				const next = await nextOutboxGeneration(tx, dbName);
				for (const key of outboxKeys) await tx.objectStore(SYNC_OUTBOX_STORE).put(next, key);
			}
			await tx.done;
		} catch (error) {
			await abortWrite(tx, dbName, previousGeneration);
			throw error;
		}
	});
}

export async function bulkPutNotes(
	pidOrNotes: string | Note[],
	maybeNotes?: Note[]
): Promise<void> {
	const pid = typeof pidOrNotes === 'string' ? pidOrNotes : LOCAL_PROFILE_ID;
	const notes = typeof pidOrNotes === 'string' ? (maybeNotes ?? []) : pidOrNotes;
	for (const note of notes) {
		await putNote(pid, note);
	}
}

export async function bulkPutLabels(
	pidOrLabels: string | Label[],
	maybeLabels?: Label[]
): Promise<void> {
	const pid = typeof pidOrLabels === 'string' ? pidOrLabels : LOCAL_PROFILE_ID;
	const labels = typeof pidOrLabels === 'string' ? (maybeLabels ?? []) : pidOrLabels;
	const generation = writeGeneration;
	await enqueueDeviceWrite(async () => {
		if (generation !== writeGeneration) return;
		const db = await getDB(pid);
		const tx = db.transaction(LABELS_STORE, 'readwrite');
		for (const label of labels) tx.store.put(plainLabel(label));
		await tx.done;
	});
}

export async function clearAllNotes(pid: string = LOCAL_PROFILE_ID): Promise<void> {
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const tx = db.transaction([NOTES_STORE, IMAGES_STORE], 'readwrite');
		tx.objectStore(NOTES_STORE).clear();
		tx.objectStore(IMAGES_STORE).clear();
		await tx.done;
	});
}

export async function clearAllLabels(pid: string = LOCAL_PROFILE_ID): Promise<void> {
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		await db.clear(LABELS_STORE);
	});
}

export function replaceAllDeviceData(
	pidOrNotes: string | Note[],
	notesOrLabels: Note[] | Label[],
	labelsOrCb?: Label[] | ((note: Note) => void | Promise<void>),
	maybeCb?: (note: Note) => void | Promise<void>
): Promise<void> {
	const isScoped = typeof pidOrNotes === 'string';
	const pid = isScoped ? pidOrNotes : LOCAL_PROFILE_ID;
	const notes = isScoped ? (notesOrLabels as Note[]) : (pidOrNotes as Note[]);
	const labels = isScoped ? (labelsOrCb as Label[]) : (notesOrLabels as Label[]);
	const onNoteCommitted = isScoped
		? maybeCb
		: (labelsOrCb as ((note: Note) => void | Promise<void>) | undefined);

	const generation = ++writeGeneration;
	return enqueueDeviceWrite(async () => {
		if (generation !== writeGeneration) return;
		const db = await getDB(pid);
		const clear = db.transaction([NOTES_STORE, IMAGES_STORE, LABELS_STORE], 'readwrite');
		clear.objectStore(NOTES_STORE).clear();
		clear.objectStore(IMAGES_STORE).clear();
		clear.objectStore(LABELS_STORE).clear();
		await clear.done;
		let firstError: unknown = null;
		for (const note of notes) {
			try {
				await putNoteSnapshot(pid, plainNote(note));
				await onNoteCommitted?.(note);
			} catch (error) {
				firstError ??= error;
			}
		}
		const labelWrite = db.transaction(LABELS_STORE, 'readwrite');
		for (const label of labels) labelWrite.store.put(plainLabel(label));
		await labelWrite.done;
		if (firstError) throw firstError;
	});
}

// --- Link previews (shared cache, not profile-scoped) -----------------------

export async function getCachedLinkPreview(url: string): Promise<LinkPreview | undefined> {
	const db = await getDB();
	const row = await db.get(LINK_PREVIEWS_STORE, url);
	if (!row || typeof row !== 'object') return undefined;
	const { url: cachedUrl, hostname, title, description, image, icon } = row as LinkPreview;
	if (typeof cachedUrl !== 'string' || typeof hostname !== 'string' || typeof title !== 'string')
		return undefined;
	return plainLinkPreview({
		url: cachedUrl,
		hostname,
		title,
		...(typeof description === 'string' ? { description } : {}),
		...(typeof image === 'string' ? { image } : {}),
		...(typeof icon === 'string' ? { icon } : {})
	});
}

export async function putCachedLinkPreview(preview: LinkPreview): Promise<void> {
	const db = await getDB();
	await db.put(LINK_PREVIEWS_STORE, {
		url: String(preview.url),
		hostname: String(preview.hostname),
		title: String(preview.title),
		...(preview.description ? { description: String(preview.description) } : {}),
		...(preview.image ? { image: String(preview.image) } : {}),
		...(preview.icon ? { icon: String(preview.icon) } : {}),
		savedAt: Date.now()
	});
}

// --- Sync state KV ----------------------------------------------------------

export async function getSyncState<T>(key: string, pid?: string): Promise<T | undefined> {
	const { pid: extractedPid, baseKey } = extractPidFromStateKey(key);
	const resolvedPid = pid ?? extractedPid;
	const db = await getDB(resolvedPid);
	const val = (await db.get(SYNC_STATE_STORE, key)) as T | undefined;
	if (val !== undefined) return val;
	if (baseKey !== key) {
		return (await db.get(SYNC_STATE_STORE, baseKey)) as T | undefined;
	}
	return undefined;
}

export async function setSyncState(key: string, value: unknown, pid?: string): Promise<void> {
	const { pid: extractedPid, baseKey } = extractPidFromStateKey(key);
	const resolvedPid = pid ?? extractedPid;
	await enqueueDeviceWrite(async () => {
		const db = await getDB(resolvedPid);
		const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
		tx.objectStore(SYNC_STATE_STORE).put(value, key);
		if (baseKey !== key) {
			tx.objectStore(SYNC_STATE_STORE).put(value, baseKey);
		}
		await tx.done;
	});
}

export async function deleteSyncState(key: string, pid?: string): Promise<void> {
	const { pid: extractedPid, baseKey } = extractPidFromStateKey(key);
	const resolvedPid = pid ?? extractedPid;
	await enqueueDeviceWrite(async () => {
		const db = await getDB(resolvedPid);
		const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
		tx.objectStore(SYNC_STATE_STORE).delete(key);
		if (baseKey !== key) {
			tx.objectStore(SYNC_STATE_STORE).delete(baseKey);
		}
		await tx.done;
	});
}

const FIRED_REMINDERS_KEY = 'scrapscache-fired-reminders';

export async function getFiredReminderKeys(pid: string = LOCAL_PROFILE_ID): Promise<string[]> {
	const stored = await getSyncState<unknown>(scopedStateKey(FIRED_REMINDERS_KEY, pid), pid);
	return Array.isArray(stored)
		? stored.filter((item): item is string => typeof item === 'string')
		: [];
}

export async function setFiredReminderKeys(pid: string, keys: Iterable<string>): Promise<void> {
	const clean = [...new Set(keys)].filter((item): item is string => typeof item === 'string');
	await setSyncState(scopedStateKey(FIRED_REMINDERS_KEY, pid), clean, pid);
}

export async function claimFiredReminderKey(
	key: string,
	pid: string = LOCAL_PROFILE_ID
): Promise<boolean> {
	return enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const storeKey = scopedStateKey(FIRED_REMINDERS_KEY, pid);
		const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
		const stored = await tx.store.get(storeKey);
		const keys = new Set(
			Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []
		);
		if (keys.has(key)) {
			await tx.done;
			return false;
		}
		keys.add(key);
		await tx.store.put([...keys], storeKey);
		await tx.done;
		return true;
	});
}

// --- Outbox -----------------------------------------------------------------

const OUTBOX_GENERATION_KEY = 'scrapscache-outbox-generation';

function abortWrite(
	tx:
		| IDBPTransaction<unknown, string[], 'readwrite'>
		| IDBPTransaction<unknown, string[], 'readonly'>,
	dbName: string,
	previousGeneration: number | null
): Promise<void> {
	try {
		tx.abort();
	} catch {
		// The transaction may already have aborted after a failed request.
	}
	if (previousGeneration != null) {
		outboxGenerations.set(dbName, previousGeneration);
	} else {
		outboxGenerations.delete(dbName);
	}
	return tx.done.catch(() => undefined);
}

async function loadOutboxGeneration(db: IDBPDatabase, dbName: string): Promise<number> {
	let cached = outboxGenerations.get(dbName);
	if (cached == null) {
		cached = Number((await db.get(SYNC_STATE_STORE, OUTBOX_GENERATION_KEY)) ?? 0);
		outboxGenerations.set(dbName, cached);
	}
	return cached;
}

async function nextOutboxGeneration(
	tx: IDBPTransaction<unknown, string[], 'readwrite'>,
	dbName: string
): Promise<number> {
	let cached = outboxGenerations.get(dbName);
	if (cached == null) {
		cached = Number((await tx.objectStore(SYNC_STATE_STORE).get(OUTBOX_GENERATION_KEY)) ?? 0);
	}
	const generation = Math.max(Date.now(), cached + 1);
	outboxGenerations.set(dbName, generation);
	await tx.objectStore(SYNC_STATE_STORE).put(generation, OUTBOX_GENERATION_KEY);
	return generation;
}

export function getOutboxGeneration(pid: string = LOCAL_PROFILE_ID): Promise<number> {
	const dbName = resolveDbName(pid);
	return enqueueDeviceWrite(async () => loadOutboxGeneration(await getDB(pid), dbName));
}

function uniqueOutboxKeys(keys: Iterable<string>): string[] {
	return [...new Set(keys)];
}

/**
 * Both arguments are named. A single key is a string and so is a workspace, so
 * a signature that took either could mark a signed-in workspace's uploads
 * against the anonymous one, and those changes would never leave the device.
 */
export async function markSyncOutbox(pid: string, keys: Iterable<string>): Promise<number> {
	const unique = uniqueOutboxKeys(keys);
	if (unique.length === 0) return 0;
	const dbName = resolveDbName(pid);
	return enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const previousGeneration = outboxGenerations.get(dbName) ?? null;
		const tx = db.transaction([SYNC_STATE_STORE, SYNC_OUTBOX_STORE], 'readwrite');
		try {
			const generation = await nextOutboxGeneration(tx, dbName);
			const outbox = tx.objectStore(SYNC_OUTBOX_STORE);
			for (const key of unique) await outbox.put(generation, key);
			await tx.done;
			return generation;
		} catch (error) {
			await abortWrite(tx, dbName, previousGeneration);
			throw error;
		}
	});
}

export async function getSyncOutboxKeys(pid: string = LOCAL_PROFILE_ID): Promise<string[]> {
	const db = await getDB(pid);
	const keys = await db.getAllKeys(SYNC_OUTBOX_STORE);
	return keys.map(String);
}

export async function clearSyncOutbox(
	pid: string,
	keys: Iterable<string>,
	through: number = Number.POSITIVE_INFINITY
): Promise<void> {
	const unique = uniqueOutboxKeys(keys);
	if (unique.length === 0) return;
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const tx = db.transaction(SYNC_OUTBOX_STORE, 'readwrite');
		for (const key of unique) {
			const markedAt = Number(await tx.store.get(key));
			if (markedAt > 0 && markedAt <= through) await tx.store.delete(key);
		}
		await tx.done;
	});
}

export async function commitSyncControl(
	pid: string,
	state: Iterable<readonly [key: string, value: unknown]>,
	acknowledgements: Iterable<{ keys: Iterable<string>; through: number }> = []
): Promise<void> {
	const entries = [...state];
	const acknowledged = [...acknowledgements].map(({ keys, through }) => ({
		keys: uniqueOutboxKeys(keys),
		through
	}));
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const tx = db.transaction([SYNC_STATE_STORE, SYNC_OUTBOX_STORE], 'readwrite');
		try {
			const syncState = tx.objectStore(SYNC_STATE_STORE);
			const outbox = tx.objectStore(SYNC_OUTBOX_STORE);
			for (const [key, value] of entries) await syncState.put(value, key);
			for (const { keys, through } of acknowledged) {
				for (const key of keys) {
					const markedAt = Number(await outbox.get(key));
					if (markedAt > 0 && markedAt <= through) await outbox.delete(key);
				}
			}
			await tx.done;
		} catch (error) {
			try {
				tx.abort();
			} catch {
				// aborted
			}
			await tx.done.catch(() => undefined);
			throw error;
		}
	});
}

// --- Profiles ---------------------------------------------------------------

function isStoredProfile(value: unknown): value is StoredProfile {
	if (!value || typeof value !== 'object') return false;
	const row = value as Partial<StoredProfile>;
	return (
		typeof row.id === 'string' &&
		typeof row.name === 'string' &&
		typeof row.syncKey === 'string' &&
		typeof row.createdAt === 'number'
	);
}

export function readStoredProfiles(): StoredProfile[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(LS_PROFILES) ?? localStorage.getItem(LS_PROFILES_LEGACY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) return parsed.filter(isStoredProfile);
	} catch {
		// fall back to empty list
	}
	return [];
}

export async function listStoredProfiles(): Promise<StoredProfile[]> {
	return readStoredProfiles();
}

export async function putStoredProfile(profile: StoredProfile): Promise<void> {
	if (typeof localStorage === 'undefined') return;
	const current = await listStoredProfiles();
	const index = current.findIndex((p) => p.id === profile.id);
	const stored: StoredProfile = {
		id: String(profile.id),
		name: String(profile.name),
		syncKey: String(profile.syncKey),
		createdAt: Number(profile.createdAt) || Date.now()
	};
	if (index >= 0) {
		current[index] = stored;
	} else {
		current.push(stored);
	}
	try {
		localStorage.setItem(LS_PROFILES, JSON.stringify(current));
	} catch {
		// local storage quota or error
	}
}

export async function deleteProfileDatabase(pid: string): Promise<void> {
	const dbName = resolveDbName(pid);
	const p = dbPromises.get(dbName);
	if (p) {
		dbPromises.delete(dbName);
		try {
			const db = await p;
			db.close();
		} catch {}
	}
	if (typeof indexedDB !== 'undefined') {
		await new Promise<void>((resolve, reject) => {
			const req = indexedDB.deleteDatabase(dbName);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
			req.onblocked = () => resolve();
		});
	}
}

export function removeProfileFromLocalStorage(id: string): void {
	if (typeof localStorage === 'undefined') return;
	try {
		const raw = localStorage.getItem(LS_PROFILES) ?? localStorage.getItem(LS_PROFILES_LEGACY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				const next = parsed.filter((p: StoredProfile) => p.id !== id);
				localStorage.setItem(LS_PROFILES, JSON.stringify(next));
			}
		}
		localStorage.removeItem(`scrapscache-notes-mirror:${id}`);
		localStorage.removeItem(`scrapscache-labels-mirror:${id}`);
	} catch {}
}

export async function deleteStoredProfile(id: string): Promise<void> {
	removeProfileFromLocalStorage(id);
	await deleteProfileDatabase(id);
}

export async function copyProfileNamespace(fromPid: string, toPid: string): Promise<void> {
	const fromDb = await getDB(fromPid);
	const toDb = await getDB(toPid);

	// Notes
	const notes = (await fromDb.getAll(NOTES_STORE)) as Note[];
	if (notes.length > 0) {
		const tx = toDb.transaction(NOTES_STORE, 'readwrite');
		for (const n of notes) tx.objectStore(NOTES_STORE).put(plainNote(n));
		await tx.done;
	}

	// Labels
	const labels = (await fromDb.getAll(LABELS_STORE)) as Label[];
	if (labels.length > 0) {
		const tx = toDb.transaction(LABELS_STORE, 'readwrite');
		for (const l of labels) tx.objectStore(LABELS_STORE).put(plainLabel(l));
		await tx.done;
	}

	// Images
	const imageKeys = (await fromDb.getAllKeys(IMAGES_STORE)) as string[];
	if (imageKeys.length > 0) {
		const entries: Array<{ key: string; blob: unknown }> = [];
		for (const key of imageKeys) {
			const blob = await fromDb.get(IMAGES_STORE, key);
			if (blob) entries.push({ key, blob });
		}
		if (entries.length > 0) {
			const tx = toDb.transaction(IMAGES_STORE, 'readwrite');
			for (const { key, blob } of entries) {
				tx.objectStore(IMAGES_STORE).put(blob, key);
			}
			await tx.done;
		}
	}

	// Sync state
	const stateKeys = (await fromDb.getAllKeys(SYNC_STATE_STORE)) as string[];
	if (stateKeys.length > 0) {
		const entries: Array<{ key: string; val: unknown }> = [];
		for (const key of stateKeys) {
			const val = await fromDb.get(SYNC_STATE_STORE, key);
			if (val !== undefined) {
				entries.push({ key, val });
				const { baseKey } = extractPidFromStateKey(key);
				if (toPid && toPid !== LOCAL_PROFILE_ID) {
					entries.push({ key: scopedStateKey(baseKey, toPid), val });
				}
			}
		}
		if (entries.length > 0) {
			const tx = toDb.transaction(SYNC_STATE_STORE, 'readwrite');
			for (const { key, val } of entries) {
				tx.objectStore(SYNC_STATE_STORE).put(val, key);
			}
			await tx.done;
		}
	}

	// Outbox
	const outboxKeys = (await fromDb.getAllKeys(SYNC_OUTBOX_STORE)) as string[];
	if (outboxKeys.length > 0) {
		const entries: Array<{ key: string; val: unknown }> = [];
		for (const key of outboxKeys) {
			const val = await fromDb.get(SYNC_OUTBOX_STORE, key);
			if (val !== undefined) entries.push({ key, val });
		}
		if (entries.length > 0) {
			const tx = toDb.transaction(SYNC_OUTBOX_STORE, 'readwrite');
			for (const { key, val } of entries) {
				tx.objectStore(SYNC_OUTBOX_STORE).put(val, key);
			}
			await tx.done;
		}
	}
}

export async function unlinkProfileToNamespace(fromPid: string, toPid: string): Promise<void> {
	if (fromPid === toPid) return;
	await enqueueDeviceWrite(async () => {
		const source = await getDB(fromPid);
		const target = await getDB(toPid);
		const notes = (await source.getAll(NOTES_STORE)) as Note[];
		const labels = (await source.getAll(LABELS_STORE)) as Label[];
		const boardsKey = 'scrapscache-idb-kanban-boards';
		const boards: KanbanBoard[] =
			(await source.get(SYNC_STATE_STORE, scopedStateKey(boardsKey, fromPid))) ?? [];
		const images = await Promise.all(
			notes.flatMap((note) =>
				(note.images ?? []).map(async (image) => ({
					noteId: note.id,
					imageId: image.id,
					value:
						(await source.get(IMAGES_STORE, `${note.id}::${image.id}`)) ??
						(await source.get(IMAGES_STORE, `${note.id}:${image.id}`))
				}))
			)
		);
		const imageIds = new Map(images.map((image) => [image.imageId, crypto.randomUUID()]));
		const tx = target.transaction(
			[NOTES_STORE, LABELS_STORE, IMAGES_STORE, SYNC_STATE_STORE],
			'readwrite'
		);
		try {
			const noteIds = new Map<string, string>();
			const labelIds = new Map<string, string>();
			const noteTombstones =
				(await tx
					.objectStore(SYNC_STATE_STORE)
					.get(scopedStateKey('scrapscache-idb-note-tombstones', toPid))) ?? {};
			const labelTombstones =
				(await tx
					.objectStore(SYNC_STATE_STORE)
					.get(scopedStateKey('scrapscache-idb-label-tombstones', toPid))) ?? {};
			for (const label of labels) {
				const id =
					(await tx.objectStore(LABELS_STORE).get(label.id)) || labelTombstones[label.id]
						? crypto.randomUUID()
						: label.id;
				labelIds.set(label.id, id);
				await tx.objectStore(LABELS_STORE).put({ ...label, id });
			}
			for (const note of notes) {
				const id =
					(await tx.objectStore(NOTES_STORE).get(note.id)) || noteTombstones[note.id]
						? crypto.randomUUID()
						: note.id;
				noteIds.set(note.id, id);
				await tx.objectStore(NOTES_STORE).put({
					...note,
					id,
					labels: note.labels.map((id) => labelIds.get(id) ?? id),
					images: (note.images ?? []).map((image) => ({ ...image, id: imageIds.get(image.id)! }))
				});
			}
			for (const image of images) {
				if (image.value !== undefined)
					await tx
						.objectStore(IMAGES_STORE)
						.put(image.value, `${noteIds.get(image.noteId)}::${imageIds.get(image.imageId)}`);
			}
			const existingBoards: KanbanBoard[] =
				(await tx.objectStore(SYNC_STATE_STORE).get(scopedStateKey(boardsKey, toPid))) ?? [];
			const boardTombstones =
				(await tx
					.objectStore(SYNC_STATE_STORE)
					.get(scopedStateKey('scrapscache-idb-board-tombstones', toPid))) ?? {};
			const appended = boards.map((board) => ({
				...board,
				id:
					existingBoards.some((existing) => existing.id === board.id) || boardTombstones[board.id]
						? crypto.randomUUID()
						: board.id,
				columns: board.columns.map((column) => ({
					...column,
					labelId: column.labelId ? (labelIds.get(column.labelId) ?? column.labelId) : null
				})),
				backlogFilter: {
					...board.backlogFilter,
					labelIds: board.backlogFilter.labelIds.map((id) => labelIds.get(id) ?? id)
				}
			}));
			await tx
				.objectStore(SYNC_STATE_STORE)
				.put([...existingBoards, ...appended], scopedStateKey(boardsKey, toPid));
			await tx.done;
		} catch (error) {
			try {
				tx.abort();
			} catch {
				/* The failed transaction may already be aborted. */
			}
			await tx.done.catch(() => undefined);
			throw error;
		}
	});
}

/** Empty one namespace: notes, attachments, labels, its sync state, and its outbox. */
export async function clearProfileNamespace(pid: string): Promise<void> {
	await clearAllNotes(pid);
	await clearAllLabels(pid);
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		await db.clear(SYNC_OUTBOX_STORE);
		const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
		for (const prefix of SCOPED_STATE_PREFIXES) {
			tx.store.delete(scopedStateKey(prefix, pid));
		}
		await tx.done;
	});
}

/**
 * True when `sourcePid` holds nothing that `targetPid` does not already have at
 * least as recent a copy of. Adoption leaves the anonymous workspace as an
 * exact copy of the profile that took it over, and note ids are random, so a
 * workspace the user actually typed into can never look redundant by accident.
 */
export async function isNamespaceRedundant(sourcePid: string, targetPid: string): Promise<boolean> {
	if (sourcePid === targetPid) return false;
	const source = await getDB(sourcePid);
	const target = await getDB(targetPid);
	const [sourceNotes, sourceLabels] = await Promise.all([
		source.count(NOTES_STORE),
		source.count(LABELS_STORE)
	]);
	if (sourceNotes === 0 && sourceLabels === 0) return false;
	// A larger source cannot be contained in the target; skip the row reads.
	const [targetNotes, targetLabels] = await Promise.all([
		target.count(NOTES_STORE),
		target.count(LABELS_STORE)
	]);
	if (sourceNotes > targetNotes || sourceLabels > targetLabels) return false;

	for (const note of (await source.getAll(NOTES_STORE)) as Note[]) {
		const owned = (await target.get(NOTES_STORE, note.id)) as Note | undefined;
		if (!owned || Number(note.updatedAt) > Number(owned.updatedAt)) return false;
	}
	for (const label of (await source.getAll(LABELS_STORE)) as Label[]) {
		const owned = (await target.get(LABELS_STORE, label.id)) as Label | undefined;
		if (!owned || Number(label.updatedAt) > Number(owned.updatedAt)) return false;
	}

	// Boards count as much as the notes on them. A workspace whose notes all
	// live in the target can still hold the only copy of a board — renamed,
	// re-columned, or with its cards arranged by hand — and dropping it for
	// being "redundant" would take that arrangement with it.
	const sourceBoards = await boardVersions(source, sourcePid);
	if (sourceBoards.size > 0) {
		const targetBoards = await boardVersions(target, targetPid);
		for (const [id, updatedAt] of sourceBoards) {
			const owned = targetBoards.get(id);
			if (owned === undefined || updatedAt > owned) return false;
		}
	}
	return true;
}

/** When each of a workspace's boards was last edited, by board id. */
async function boardVersions(db: IDBPDatabase, pid: string): Promise<Map<string, number>> {
	const stored = await db.get(SYNC_STATE_STORE, scopedStateKey(KANBAN_BOARDS_STATE_KEY, pid));
	const boards = Array.isArray(stored) ? (stored as { id?: unknown; updatedAt?: unknown }[]) : [];
	return new Map(
		boards.flatMap((board) =>
			typeof board?.id === 'string' ? [[board.id, Number(board.updatedAt) || 0] as const] : []
		)
	);
}

export async function namespaceHasData(pid: string): Promise<boolean> {
	const db = await getDB(pid);
	const noteCount = await db.count(NOTES_STORE);
	if (noteCount > 0) return true;
	const labelCount = await db.count(LABELS_STORE);
	return labelCount > 0;
}

/**
 * Approximate on-device footprint. Attachment sizes come from the `byteSize`
 * recorded on each note's image metadata, so the blob store is only read for
 * the attachments that predate that field.
 */
export async function estimateProfileBytes(pid: string): Promise<number> {
	const db = await getDB(pid);
	let bytes = 0;
	const unsized: string[] = [];
	const notes = (await db.getAll(NOTES_STORE)) as Note[];
	for (const note of notes) {
		bytes += JSON.stringify(note).length;
		for (const image of note.images ?? []) {
			if (Number.isFinite(image.byteSize)) bytes += Number(image.byteSize);
			else unsized.push(`${note.id}::${image.id}`);
		}
	}
	const labels = (await db.getAll(LABELS_STORE)) as Label[];
	for (const label of labels) {
		bytes += JSON.stringify(label).length;
	}
	for (const key of unsized) {
		bytes += storedByteLength(await db.get(IMAGES_STORE, key));
	}
	return bytes;
}

function storedByteLength(value: unknown): number {
	if (value instanceof Blob) return value.size;
	const bytes = bytesFromStored(value);
	if (bytes) return bytes.byteLength;
	if (value && typeof value === 'object') {
		const record = value as { bytes?: unknown; blob?: unknown };
		if (record.blob instanceof Blob) return record.blob.size;
		return bytesFromStored(record.bytes)?.byteLength ?? 0;
	}
	return 0;
}
