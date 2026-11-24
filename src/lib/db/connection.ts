// Opening a workspace's database and the device's own, taking a workspace off this
// device, and the queues that keep writes to them in order.

import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { copyLinkPreview } from '#lib/model/index.js';
import type { LinkPreview } from '#lib/types.js';
import { workspaceLinkTag } from '#lib/noteLinks.js';
import {
	DEVICE_DB_NAME,
	DEVICE_DB_VERSION,
	DEVICE_STATE_STORE,
	LINK_PREVIEWS_STORE,
	NOTES_STORE,
	resolveDbName,
	SYNC_STATE_STORE,
	WORKSPACES_STORE
} from './names.js';

import type { StoredProfile } from '#lib/profiles.js';

/**
 * v7 stores workspace state under plain keys. Earlier versions wrote some of it
 * as `<key>:<workspace id>`; the upgrade renames those in place.
 */
const WORKSPACE_DB_VERSION = 8;

export const LABELS_STORE = 'labels';

export const IMAGES_STORE = 'note-images';

/** Attachment rows by the version of the bytes they hold; a row without one is not listed. */
export const IMAGE_VERSION_INDEX = 'hash';

export const SYNC_OUTBOX_STORE = 'sync-outbox';

const dbPromises = new Map<string, Promise<IDBPDatabase>>();

let deviceDbPromise: Promise<IDBPDatabase> | null = null;

const noteChains = new Map<string, Promise<void>>();

let deviceWriteChain: Promise<void> = Promise.resolve();

export const outboxGenerations = new Map<string, number>();

export function enqueueDeviceWrite<T>(operation: () => Promise<T>): Promise<T> {
	const run = deviceWriteChain.catch(() => undefined).then(operation);
	deviceWriteChain = run.then(
		() => undefined,
		() => undefined
	);
	return run;
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

/**
 * Forget every released and deleted workspace. For tests, which drop every
 * database between cases: the open connection hears that delete as another
 * window removing the workspace and would refuse it for the rest of the file.
 */
export function forgetReleasedProfiles(): void {
	departedProfiles.clear();
	deletedProfiles.clear();
}

/** Hear about a workspace another window started deleting, so this one can leave it. */
export function onProfileDeleted(listener: ((pid: string) => void) | null): void {
	deletedListener = listener;
}

/** Create the workspace stores. */
function upgradeWorkspace(
	db: IDBPDatabase,
	transaction: IDBPTransaction<unknown, string[], 'versionchange'>
): void {
	for (const name of [NOTES_STORE, LABELS_STORE]) {
		if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
	}
	for (const name of [IMAGES_STORE, SYNC_STATE_STORE, SYNC_OUTBOX_STORE]) {
		if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
	}
	const images = transaction.objectStore(IMAGES_STORE);
	if (!images.indexNames.contains(IMAGE_VERSION_INDEX))
		images.createIndex(IMAGE_VERSION_INDEX, 'hash');
}

/** How long an open may wait on a window that holds an older version before it gives up. */
const OPEN_BLOCKED_GRACE_MS = 5000;

/**
 * A newer build in another window has moved this workspace's schema on, so this
 * window can neither read nor write it any more: it reloads into the new build.
 * Tests replace the reload, since jsdom cannot navigate.
 */
let reloadOutdatedWindow: () => void = () => {
	if (typeof location !== 'undefined') location.reload();
};

export function onWorkspaceOutdated(reload: () => void): void {
	reloadOutdatedWindow = reload;
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
		promise = openWorkspaceDB(pid, dbName);
		dbPromises.set(dbName, promise);
	}
	return promise;
}

/**
 * Open a workspace database, whatever other windows are doing with it.
 *
 * Another window may hold an older version open and never let go, so an open
 * that stays blocked rejects after a grace instead of hanging the boot; the
 * cached entry goes with it, so the next use tries again, and a connection
 * that arrives after the caller gave up is closed rather than leaked. The
 * browser can also close a connection on its own (Safari does, under storage
 * pressure); that too drops the cached entry so the next use reopens.
 */
function openWorkspaceDB(pid: string, dbName: string): Promise<IDBPDatabase> {
	const promise = new Promise<IDBPDatabase>((resolve, reject) => {
		let blockedTimer: ReturnType<typeof setTimeout> | null = null;
		// Set once the caller has been told the open failed: a connection that
		// arrives after that has no one left to close it.
		let abandoned = false;
		const cached = () => dbPromises.get(dbName) === promise;
		const opening = openDB(dbName, WORKSPACE_DB_VERSION, {
			blocked() {
				blockedTimer = setTimeout(() => {
					abandoned = true;
					if (cached()) dbPromises.delete(dbName);
					reject(
						new Error(
							'Another window is running an older version of Scraps Cache. Close or reload it, then try again.'
						)
					);
				}, OPEN_BLOCKED_GRACE_MS);
			},
			blocking(_currentVersion, blockedVersion) {
				if (cached()) closeConnection(pid);
				// A null blocked version means a delete rather than an upgrade: another
				// window is removing this workspace, and holding the connection open
				// would only stall it until its grace runs out.
				if (blockedVersion === null) {
					deletedProfiles.add(pid);
					deletedListener?.(pid);
					return;
				}
				// An upgrade: a newer build in another window. Letting go unblocks it;
				// this window's build cannot use the new schema, so it reloads.
				reloadOutdatedWindow();
			},
			terminated() {
				if (cached()) dbPromises.delete(dbName);
			},
			upgrade(db, _oldVersion, _newVersion, transaction) {
				upgradeWorkspace(db, transaction);
			}
		});
		opening.then(
			(db) => {
				if (blockedTimer !== null) clearTimeout(blockedTimer);
				if (abandoned) {
					db.close();
					return;
				}
				resolve(db);
			},
			(error: unknown) => {
				if (blockedTimer !== null) clearTimeout(blockedTimer);
				if (cached()) dbPromises.delete(dbName);
				reject(error);
			}
		);
	});
	return promise;
}

export function getDeviceDB(): Promise<IDBPDatabase> {
	if (typeof indexedDB === 'undefined') {
		return Promise.reject(new Error('IndexedDB is not available'));
	}
	if (deviceDbPromise) return deviceDbPromise;
	const opening: Promise<IDBPDatabase> = openDB(DEVICE_DB_NAME, DEVICE_DB_VERSION, {
		// A newer build in another window needs a newer schema. Let it upgrade, and
		// reopen on next use, rather than leave that window waiting on this one.
		blocking() {
			if (deviceDbPromise === opening) deviceDbPromise = null;
			void opening.then((db) => db.close()).catch(() => undefined);
		},
		upgrade(db) {
			if (!db.objectStoreNames.contains(WORKSPACES_STORE))
				db.createObjectStore(WORKSPACES_STORE, { keyPath: 'id' });
			if (!db.objectStoreNames.contains(LINK_PREVIEWS_STORE))
				db.createObjectStore(LINK_PREVIEWS_STORE, { keyPath: 'url' });
			if (!db.objectStoreNames.contains(DEVICE_STATE_STORE))
				db.createObjectStore(DEVICE_STATE_STORE);
		}
	});
	deviceDbPromise = opening;
	return opening;
}

export async function getDeviceState<T>(key: string): Promise<T | undefined> {
	const db = await getDeviceDB();
	return (await db.get(DEVICE_STATE_STORE, key)) as T | undefined;
}

/**
 * Write a device-wide fact durably before returning. Browsers flush
 * localStorage lazily, so a record that later IndexedDB writes depend on
 * belongs here.
 */
export async function setDeviceState(key: string, value: unknown): Promise<void> {
	// Opened before joining the write queue: an open that waits on another window
	// must not hold every workspace write queued behind it.
	const db = await getDeviceDB();
	return enqueueDeviceWrite(async () => {
		const tx = db.transaction(DEVICE_STATE_STORE, 'readwrite', { durability: 'strict' });
		await tx.store.put(value, key);
		await tx.done;
	});
}

/**
 * A workspace as the service worker sees it: the id names its database, and the
 * tag is the one-way link tag a notification click opens it by. Never a name or
 * a sync key.
 */
export type RegisteredWorkspace = { id: string; tag: string };

/** Keep the service worker's list of workspace databases the same as the keyring. */
export async function setRegisteredWorkspaces(
	profiles: Iterable<Pick<StoredProfile, 'id' | 'syncKey'>>
): Promise<void> {
	const rows = new Map(
		[...profiles].map((profile) => [profile.id, { id: profile.id, tag: workspaceLinkTag(profile) }])
	);
	// Opened outside the write queue, for the same reason as `setDeviceState`.
	const db = await getDeviceDB();
	return enqueueDeviceWrite(async () => {
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

export function enqueueNote<T>(
	pid: string,
	noteId: string,
	operation: () => Promise<T>
): Promise<T> {
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
