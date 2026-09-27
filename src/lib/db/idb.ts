// Device persistence. IndexedDB is the durable source of truth; localStorage is handled
// separately as a blob-free fast-boot mirror by noteStorage.ts.
// Every workspace has its own database, `scrapscache-profile-<id>`, and none is special.
// One small device database, `scrapscache-device`, lists them for the service worker
// and caches link previews.

import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { copyImage, copyLabel, copyLinkPreview, copyNote } from '$lib/model';
import type { Label, LinkPreview, Note, NoteImage } from '$lib/types';
import type { KanbanBoard } from '$lib/kanban';
import { blobToDataUrl, dataUrlToBlob } from '$lib/imageBlob';
import { workspaceLinkTag } from '$lib/noteLinks';

/**
 * v7 stores workspace state under plain keys. Earlier versions wrote some of it
 * as `<key>:<workspace id>`; the upgrade renames those in place.
 */
export const WORKSPACE_DB_VERSION = 7;
export const NOTES_STORE = 'notes';
export const LABELS_STORE = 'labels';
export const IMAGES_STORE = 'note-images';
export const SYNC_STATE_STORE = 'sync-state';
export const SYNC_OUTBOX_STORE = 'sync-outbox';

/** Lists this device's workspaces for the service worker; never names or sync keys. */
export const DEVICE_DB_NAME = 'scrapscache-device';
const DEVICE_DB_VERSION = 1;
export const WORKSPACES_STORE = 'workspaces';
const LINK_PREVIEWS_STORE = 'link-previews';

/** One workspace on this device. Private ones have an empty sync key. */
export interface StoredProfile {
	id: string;
	name: string;
	syncKey: string;
	createdAt: number;
}

/** The keyring. Its `storage` event is how other windows learn of a change. */
export const LS_PROFILES = 'scrapscache-sync-profiles';
const LS_PROFILES_LEGACY = 'gkc-sync-profiles';

const dbPromises = new Map<string, Promise<IDBPDatabase>>();
let deviceDbPromise: Promise<IDBPDatabase> | null = null;
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

export function resolveDbName(pid: string): string {
	if (!pid) throw new Error('A workspace is required');
	return `scrapscache-profile-${pid}`;
}

/** A per-workspace localStorage key. */
export function workspaceKey(base: string, pid: string): string {
	return `${base}:${pid}`;
}

/** Workspaces the keyring stopped naming. Served again if it names them again. */
const departedProfiles = new Set<string>();
/**
 * Workspaces another window asked to delete. A requested delete cannot be taken
 * back: the browser finishes it once the last connection closes, even after the
 * window that asked has given up waiting. So this lasts for the life of the page.
 */
const deletedProfiles = new Set<string>();
let deletedListener: ((pid: string) => void) | null = null;

function closeConnection(pid: string): void {
	const dbName = resolveDbName(pid);
	const open = dbPromises.get(dbName);
	if (!open) return;
	dbPromises.delete(dbName);
	void open.then(
		(db) => db.close(),
		() => undefined
	);
}

/**
 * Stop serving a workspace the keyring no longer names.
 *
 * A window that still has it open must not reach its database again. Opening it
 * would rebuild the one another window just dropped, and no keyring entry would
 * name the result: a dataset no workspace owns and no delete can find. Writes
 * already queued for it fail here instead of landing.
 */
export function releaseProfile(pid: string): void {
	departedProfiles.add(pid);
	closeConnection(pid);
}

/**
 * Serve a workspace again: the keyring names it, so this device holds it. A
 * workspace whose delete was requested stays refused whatever the keyring says,
 * since its database is on its way out.
 */
export function resumeProfile(pid: string): void {
	departedProfiles.delete(pid);
}

export function isProfileReleased(pid: string): boolean {
	return departedProfiles.has(pid) || deletedProfiles.has(pid);
}

/** Hear about a workspace another window started deleting, so this one can leave it. */
export function onProfileDeleted(listener: ((pid: string) => void) | null): void {
	deletedListener = listener;
}

/** Create the workspace stores, and move pre-v7 `<key>:<id>` state to plain keys. */
async function upgradeWorkspace(
	db: IDBPDatabase,
	oldVersion: number,
	tx: IDBPTransaction<unknown, string[], 'versionchange'>,
	pid: string
): Promise<void> {
	for (const name of [NOTES_STORE, LABELS_STORE]) {
		if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
	}
	for (const name of [IMAGES_STORE, SYNC_STATE_STORE, SYNC_OUTBOX_STORE]) {
		if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
	}
	if (oldVersion === 0 || oldVersion >= 7) return;
	// The suffixed copy was the one kept current, so it replaces the plain one.
	const suffix = `:${pid}`;
	const state = tx.objectStore(SYNC_STATE_STORE);
	let cursor = await state.openCursor();
	while (cursor) {
		const key = String(cursor.key);
		if (key.endsWith(suffix)) {
			await state.put(cursor.value, key.slice(0, -suffix.length));
			await cursor.delete();
		}
		cursor = await cursor.continue();
	}
}

export function getDB(pid: string): Promise<IDBPDatabase> {
	if (typeof indexedDB === 'undefined') {
		return Promise.reject(new Error('IndexedDB is not available'));
	}
	if (!pid) return Promise.reject(new Error('A workspace is required'));
	if (isProfileReleased(pid)) {
		return Promise.reject(new Error('That workspace is no longer on this device.'));
	}
	const dbName = resolveDbName(pid);
	let promise = dbPromises.get(dbName);
	if (!promise) {
		promise = openDB(dbName, WORKSPACE_DB_VERSION, {
			// A null blocked version means a delete rather than an upgrade: another
			// window is removing this workspace, and holding the connection open
			// would only stall it until its grace runs out.
			blocking(_currentVersion, blockedVersion) {
				if (blockedVersion !== null) return;
				deletedProfiles.add(pid);
				closeConnection(pid);
				deletedListener?.(pid);
			},
			upgrade(db, oldVersion, _newVersion, tx) {
				return upgradeWorkspace(
					db,
					oldVersion,
					tx as unknown as IDBPTransaction<unknown, string[], 'versionchange'>,
					pid
				);
			}
		});
		dbPromises.set(dbName, promise);
	}
	return promise;
}

export function getDeviceDB(): Promise<IDBPDatabase> {
	if (typeof indexedDB === 'undefined') {
		return Promise.reject(new Error('IndexedDB is not available'));
	}
	deviceDbPromise ??= openDB(DEVICE_DB_NAME, DEVICE_DB_VERSION, {
		upgrade(db) {
			if (!db.objectStoreNames.contains(WORKSPACES_STORE))
				db.createObjectStore(WORKSPACES_STORE, { keyPath: 'id' });
			if (!db.objectStoreNames.contains(LINK_PREVIEWS_STORE))
				db.createObjectStore(LINK_PREVIEWS_STORE, { keyPath: 'url' });
		}
	});
	return deviceDbPromise;
}

/**
 * A workspace as the service worker sees it: the id names its database, and the
 * tag is the one-way link tag a notification click opens it by. Never a name or
 * a sync key.
 */
export type RegisteredWorkspace = { id: string; tag: string };

/** Keep the service worker's list of workspace databases the same as the keyring. */
export function setRegisteredWorkspaces(
	profiles: Iterable<Pick<StoredProfile, 'id' | 'syncKey'>>
): Promise<void> {
	const rows = new Map(
		[...profiles].map((profile) => [profile.id, { id: profile.id, tag: workspaceLinkTag(profile) }])
	);
	return enqueueDeviceWrite(async () => {
		const db = await getDeviceDB();
		const tx = db.transaction(WORKSPACES_STORE, 'readwrite');
		for (const id of (await tx.store.getAllKeys()) as string[]) {
			if (!rows.has(id)) await tx.store.delete(id);
		}
		for (const row of rows.values()) await tx.store.put(row);
		await tx.done;
	});
}

export async function getRegisteredWorkspaces(): Promise<RegisteredWorkspace[]> {
	const db = await getDeviceDB();
	return (await db.getAll(WORKSPACES_STORE)) as RegisteredWorkspace[];
}

/** How long a delete may stay blocked before the caller stops waiting on it. */
const DELETE_BLOCKED_GRACE_MS = 2000;

/**
 * A delete that stayed blocked past its grace. It has not failed and cannot be
 * called off: the browser finishes it the moment the last connection closes.
 * `completion` settles when that happens.
 */
export class DeleteBlockedError extends Error {
	constructor(readonly completion: Promise<void>) {
		super('Timed out deleting a local database: a connection to it is still open.');
		this.name = 'DeleteBlockedError';
	}
}

/**
 * Delete a database and report what actually happened.
 *
 * A blocked delete is not a success: some connection is still open, and the
 * browser will only finish once it closes. Resolving there would tell a caller
 * their data is gone while all of it is still on the device, so the block is
 * waited out, and a lasting one rejects with a `DeleteBlockedError` that still
 * reports when the delete lands. The database is never named in either error:
 * its name carries the workspace id.
 */
export function dropDatabase(name: string, graceMs = DELETE_BLOCKED_GRACE_MS): Promise<void> {
	if (typeof indexedDB === 'undefined') return Promise.resolve();
	return new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(name);
		let blockedTimer: ReturnType<typeof setTimeout> | null = null;
		const completion = new Promise<void>((finish, fail) => {
			request.onsuccess = () => finish();
			request.onerror = () =>
				fail(request.error ?? new Error('Could not delete a local database.'));
		});
		// Once the caller has been told the delete is blocked it may never listen
		// again; a later failure must not surface as an unhandled rejection.
		completion.catch(() => undefined);
		completion.then(
			() => {
				if (blockedTimer !== null) clearTimeout(blockedTimer);
				resolve();
			},
			(error: unknown) => {
				if (blockedTimer !== null) clearTimeout(blockedTimer);
				reject(error);
			}
		);
		request.onblocked = () => {
			blockedTimer = setTimeout(() => reject(new DeleteBlockedError(completion)), graceMs);
		};
	});
}

/**
 * Settle the queued writes, then drop the cached connections. Closing without
 * waiting would both lose a queued write and leave its connection open past
 * the close, which is what blocks the delete that usually follows.
 */
export async function closeDeviceDatabase(): Promise<void> {
	await waitForDeviceWrites();
	const existing = [...dbPromises.values(), ...(deviceDbPromise ? [deviceDbPromise] : [])];
	dbPromises.clear();
	deviceDbPromise = null;
	deviceWriteChain = Promise.resolve();
	noteChains.clear();
	writeGeneration = 0;
	outboxGenerations.clear();
	departedProfiles.clear();
	deletedProfiles.clear();
	await Promise.all(
		existing.map((p) =>
			p.then(
				(db) => {
					db.close();
				},
				() => undefined
			)
		)
	);
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

/** Plain clone — never hand Svelte proxies to IndexedDB. */
function plainNote(note: Note): Note {
	return copyNote(note);
}

function plainLabel(label: Label): Label {
	return copyLabel(label);
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
	if (meta.dataUrl?.length > 20) return copyImage(meta);
	const blob =
		(await blobFromStored(await db.get(IMAGES_STORE, `${noteId}::${meta.id}`))) ??
		(await blobFromStored(await db.get(IMAGES_STORE, `${noteId}:${meta.id}`)));
	if (!blob) {
		return copyImage({ ...meta, dataUrl: '' });
	}
	return copyImage({
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

export async function hydrateNoteAttachments(pid: string, note: Note): Promise<Note> {
	const db = await getDB(pid);
	return hydrateNoteImages(db, note);
}

export async function putNote(pid: string, note: Note, keys: Iterable<string> = []): Promise<void> {
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

export async function getAllLabels(pid: string): Promise<Label[]> {
	const db = await getDB(pid);
	return ((await db.getAll(LABELS_STORE)) as Label[]).map(plainLabel);
}

export async function putLabel(
	pid: string,
	label: Label,
	syncOutboxKeys: Iterable<string> = []
): Promise<void> {
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
	pid: string,
	id: string,
	state: Iterable<readonly [key: string, value: unknown]>,
	syncOutboxKeys: Iterable<string> = []
): Promise<void> {
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
			for (const [key, value] of entries) await syncState.put(value, key);
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
	pid: string,
	state: Iterable<readonly [key: string, value: unknown]>,
	syncOutboxKeys: Iterable<string> = []
): Promise<void> {
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
			for (const [key, value] of entries) await store.put(value, key);
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

/**
 * Read, merge and write one state value in a single transaction, queueing the
 * outbox keys the merge asks for. For state more than one window or workspace
 * writes: a separate read and write could drop what another wrote in between.
 */
export async function mergeSyncStateWithOutbox<T>(
	pid: string,
	key: string,
	merge: (current: unknown) => { value: T; outboxKeys: Iterable<string> }
): Promise<T> {
	const result = await mergeWorkspaceState(pid, [key], (current) => {
		const { value, outboxKeys } = merge(current[key]);
		return { value: { [key]: value }, outboxKeys };
	});
	return result[key];
}

export async function mergeWorkspaceState<T extends Record<string, unknown>>(
	pid: string,
	keys: readonly string[],
	merge: (current: Record<string, unknown>) => { value: T; outboxKeys?: Iterable<string> }
): Promise<T> {
	const dbName = resolveDbName(pid);
	return enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const previousGeneration = outboxGenerations.get(dbName) ?? null;
		const tx = db.transaction([SYNC_STATE_STORE, SYNC_OUTBOX_STORE], 'readwrite');
		try {
			const state = tx.objectStore(SYNC_STATE_STORE);
			const current = Object.fromEntries(
				await Promise.all(keys.map(async (key) => [key, await state.get(key)]))
			);
			const { value, outboxKeys = [] } = merge(current);
			for (const [key, item] of Object.entries(value)) await state.put(item, key);
			const dirtyKeys = uniqueOutboxKeys(outboxKeys);
			if (dirtyKeys.length) {
				const next = await nextOutboxGeneration(tx, dbName);
				for (const outboxKey of dirtyKeys)
					await tx.objectStore(SYNC_OUTBOX_STORE).put(next, outboxKey);
			}
			await tx.done;
			return value;
		} catch (error) {
			await abortWrite(tx, dbName, previousGeneration);
			throw error;
		}
	});
}

export async function bulkPutNotes(pid: string, notes: Note[]): Promise<void> {
	for (const note of notes) {
		await putNote(pid, note);
	}
}

export async function bulkPutLabels(pid: string, labels: Label[]): Promise<void> {
	const generation = writeGeneration;
	await enqueueDeviceWrite(async () => {
		if (generation !== writeGeneration) return;
		const db = await getDB(pid);
		const tx = db.transaction(LABELS_STORE, 'readwrite');
		for (const label of labels) tx.store.put(plainLabel(label));
		await tx.done;
	});
}

export async function clearAllNotes(pid: string): Promise<void> {
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const tx = db.transaction([NOTES_STORE, IMAGES_STORE], 'readwrite');
		tx.objectStore(NOTES_STORE).clear();
		tx.objectStore(IMAGES_STORE).clear();
		await tx.done;
	});
}

export async function clearAllLabels(pid: string): Promise<void> {
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		await db.clear(LABELS_STORE);
	});
}

export function replaceAllDeviceData(
	pid: string,
	notes: Note[],
	labels: Label[],
	onNoteCommitted?: (note: Note) => void | Promise<void>
): Promise<void> {
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

// --- Link previews (device cache, shared by every workspace) ----------------

export async function getCachedLinkPreview(url: string): Promise<LinkPreview | undefined> {
	const db = await getDeviceDB();
	const row = await db.get(LINK_PREVIEWS_STORE, url);
	if (!row || typeof row !== 'object') return undefined;
	const { url: cachedUrl, hostname, title, description, image, icon } = row as LinkPreview;
	if (typeof cachedUrl !== 'string' || typeof hostname !== 'string' || typeof title !== 'string')
		return undefined;
	return copyLinkPreview({
		url: cachedUrl,
		hostname,
		title,
		...(typeof description === 'string' ? { description } : {}),
		...(typeof image === 'string' ? { image } : {}),
		...(typeof icon === 'string' ? { icon } : {})
	});
}

export async function putCachedLinkPreview(preview: LinkPreview): Promise<void> {
	const db = await getDeviceDB();
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

export async function getSyncState<T>(pid: string, key: string): Promise<T | undefined> {
	const db = await getDB(pid);
	return (await db.get(SYNC_STATE_STORE, key)) as T | undefined;
}

export async function setSyncState(pid: string, key: string, value: unknown): Promise<void> {
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		await db.put(SYNC_STATE_STORE, value, key);
	});
}

export async function deleteSyncState(pid: string, key: string): Promise<void> {
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		await db.delete(SYNC_STATE_STORE, key);
	});
}

const FIRED_REMINDERS_KEY = 'scrapscache-fired-reminders';

export async function getFiredReminderKeys(pid: string): Promise<string[]> {
	const stored = await getSyncState<unknown>(pid, FIRED_REMINDERS_KEY);
	return Array.isArray(stored)
		? stored.filter((item): item is string => typeof item === 'string')
		: [];
}

/**
 * Add to the fired-reminder ledger in one transaction. The service worker writes
 * the same ledger, so reading it and writing it back separately could drop a
 * reminder it claimed in between. Resolves to the keys that were not there yet.
 */
export async function addFiredReminderKeys(pid: string, keys: Iterable<string>): Promise<string[]> {
	const wanted = [...new Set(keys)];
	return enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const storeKey = FIRED_REMINDERS_KEY;
		const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
		const stored = await tx.store.get(storeKey);
		const fired = new Set(
			Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []
		);
		const added = wanted.filter((key) => !fired.has(key));
		if (added.length) await tx.store.put([...fired, ...added], storeKey);
		await tx.done;
		return added;
	});
}

export async function claimFiredReminderKey(pid: string, key: string): Promise<boolean> {
	return (await addFiredReminderKeys(pid, [key])).length > 0;
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

export function getOutboxGeneration(pid: string): Promise<number> {
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

export async function getSyncOutboxKeys(pid: string): Promise<string[]> {
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

/** Write the keyring and bring the service worker's workspace list in line with it. */
export function writeStoredProfiles(profiles: StoredProfile[]): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(LS_PROFILES, JSON.stringify(profiles));
	} catch {
		// local storage quota or error
	}
	void setRegisteredWorkspaces(profiles).catch(() => undefined);
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
	writeStoredProfiles(current);
}

export async function deleteProfileDatabase(pid: string): Promise<void> {
	const dbName = resolveDbName(pid);
	// A write still queued for this workspace would reopen the database midway
	// through removing it, so let the queue drain before the connection goes.
	await waitForDeviceWrites(pid);
	const p = dbPromises.get(dbName);
	if (p) {
		dbPromises.delete(dbName);
		try {
			const db = await p;
			db.close();
		} catch {}
	}
	// Refused from here on, in this window as in every other: an open request
	// would queue behind the delete and then build an empty database back.
	deletedProfiles.add(pid);
	try {
		await dropDatabase(dbName);
	} catch (error) {
		// Only an outright failure leaves the database in place and still usable;
		// a blocked delete is merely waiting to land.
		if (!(error instanceof DeleteBlockedError)) deletedProfiles.delete(pid);
		throw error;
	}
}

function removeProfileFromLocalStorage(id: string): void {
	writeStoredProfiles(readStoredProfiles().filter((profile) => profile.id !== id));
}

/**
 * Removes the keyring entry together with its entire dataset on this device.
 *
 * The keyring entry follows the dataset, never leads it: an entry removed while
 * the data stayed would leave every note on the device, reachable by nothing and
 * removable by no one. A delete that errors leaves both, and the workspace
 * whole. A delete that is blocked has only been put off — the browser finishes
 * it once the other connection closes — so the entry goes when it lands.
 */
export async function deleteStoredProfile(id: string): Promise<void> {
	try {
		await deleteProfileDatabase(id);
	} catch (error) {
		if (error instanceof DeleteBlockedError)
			void error.completion.then(
				() => removeProfileFromLocalStorage(id),
				() => undefined
			);
		throw error;
	}
	removeProfileFromLocalStorage(id);
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
