// One-time move of the old default workspace. It lived in the bare `scrapscache`
// database under the keyring id `device-local`; from here on it is an ordinary
// workspace, `scrapscache-profile-<id>`, like every other.
import { openDB, type IDBPDatabase } from 'idb';
import {
	DeleteBlockedError,
	dropDatabase,
	getDB,
	IMAGES_STORE,
	LABELS_STORE,
	NOTES_STORE,
	readStoredProfiles,
	SYNC_OUTBOX_STORE,
	SYNC_STATE_STORE,
	workspaceKey,
	writeStoredProfiles,
	type StoredProfile
} from '$lib/db/idb';
import { randomOpaqueId } from '$lib/syncPairing';
import { getLastActiveProfileId, nextProfileName, setLastActiveProfileId } from '$lib/profiles';

export const LEGACY_WORKSPACE_ID = 'device-local';
export const LEGACY_DB_NAME = 'scrapscache';
const MOVE_LOCK = 'scrapscache-workspace-move';
/** `{ to, phase }` while a move is under way, so an interrupted one resumes with the same id. */
export const MOVE_MARKER_KEY = 'scrapscache-workspace-move';
/** Set once nothing is left to move, so later boots skip the probe. */
export const MOVE_DONE_KEY = 'scrapscache-workspace-move-done';

/** The old default workspace's localStorage mirrors, which had no workspace suffix. */
const LEGACY_MIRROR_KEYS = [
	'scrapscache-notes-mirror',
	'scrapscache-labels-mirror',
	'scrapscache-kanban-boards-v1',
	'scrapscache-kanban-active-board-v1',
	'scrapscache-kanban-board-tombstones-v1',
	'scrapscache-fired-reminders-mirror'
];
const SYNC_STATUS_KEY = 'scrapscache-sync-status';
const COPIED_STORES = [
	NOTES_STORE,
	LABELS_STORE,
	IMAGES_STORE,
	SYNC_STATE_STORE,
	SYNC_OUTBOX_STORE
];
/** Attachments are copied a few at a time so a large workspace never sits in memory at once. */
const COPY_BATCH = 25;

type MoveMarker = { to: string; phase: 'copying' | 'moved' };

function readMarker(): MoveMarker | null {
	try {
		const parsed = JSON.parse(localStorage.getItem(MOVE_MARKER_KEY) ?? 'null') as unknown;
		if (!parsed || typeof parsed !== 'object') return null;
		const { to, phase } = parsed as Partial<MoveMarker>;
		return typeof to === 'string' && to && (phase === 'copying' || phase === 'moved')
			? { to, phase }
			: null;
	} catch {
		return null;
	}
}

function writeMarker(marker: MoveMarker | null): void {
	if (marker) localStorage.setItem(MOVE_MARKER_KEY, JSON.stringify(marker));
	else localStorage.removeItem(MOVE_MARKER_KEY);
}

/** Whether the old database is on this device, without creating it by asking. */
async function legacyDatabaseExists(): Promise<boolean | null> {
	if (typeof indexedDB.databases !== 'function') return null;
	const databases = await indexedDB.databases();
	return databases.some((database) => database.name === LEGACY_DB_NAME);
}

async function legacyHasData(legacy: IDBPDatabase): Promise<boolean> {
	for (const name of [NOTES_STORE, LABELS_STORE, SYNC_STATE_STORE]) {
		if (legacy.objectStoreNames.contains(name) && (await legacy.count(name)) > 0) return true;
	}
	return false;
}

/** Copy every record, then check the copy holds as many as the original. */
async function copyStores(legacy: IDBPDatabase, target: IDBPDatabase): Promise<void> {
	for (const name of COPIED_STORES) {
		if (!legacy.objectStoreNames.contains(name)) continue;
		const keys = await legacy.getAllKeys(name);
		const inline = target.transaction(name).store.keyPath != null;
		for (let offset = 0; offset < keys.length; offset += COPY_BATCH) {
			const batch = keys.slice(offset, offset + COPY_BATCH);
			const read = legacy.transaction(name);
			const values = await Promise.all(batch.map((key) => read.store.get(key)));
			await read.done;
			const write = target.transaction(name, 'readwrite');
			for (const [index, value] of values.entries()) {
				if (value === undefined) continue;
				if (inline) void write.store.put(value);
				else void write.store.put(value, batch[index]);
			}
			await write.done;
		}
		if ((await target.count(name)) < keys.length) {
			throw new Error('The old workspace could not be copied completely.');
		}
	}
}

function moveMirrors(to: string): void {
	const moves: [string, string][] = [
		...LEGACY_MIRROR_KEYS.map((key): [string, string] => [key, workspaceKey(key, to)]),
		[workspaceKey(SYNC_STATUS_KEY, LEGACY_WORKSPACE_ID), workspaceKey(SYNC_STATUS_KEY, to)]
	];
	for (const [from, into] of moves) {
		const value = localStorage.getItem(from);
		if (value !== null && localStorage.getItem(into) === null) localStorage.setItem(into, value);
		localStorage.removeItem(from);
	}
}

/** Name the moved workspace in the keyring: the old entry keeps its name and key. */
function adoptInKeyring(to: string): void {
	const profiles = readStoredProfiles();
	if (profiles.some((profile) => profile.id === to)) return;
	const legacy = profiles.find((profile) => profile.id === LEGACY_WORKSPACE_ID);
	const moved: StoredProfile = legacy
		? { ...legacy, id: to }
		: { id: to, name: nextProfileName(profiles), syncKey: '', createdAt: 0 };
	writeStoredProfiles([...profiles.filter((profile) => profile.id !== LEGACY_WORKSPACE_ID), moved]);
	if (getLastActiveProfileId() === LEGACY_WORKSPACE_ID) setLastActiveProfileId(to);
}

/** Drop the old database; one another window still holds is finished on a later boot. */
async function retireLegacyDatabase(): Promise<void> {
	try {
		await dropDatabase(LEGACY_DB_NAME);
	} catch (error) {
		if (error instanceof DeleteBlockedError) {
			void error.completion.then(finish, () => undefined);
			return;
		}
		throw error;
	}
	finish();
}

function finish(): void {
	writeMarker(null);
	localStorage.setItem(MOVE_DONE_KEY, '1');
}

async function moveLocked(): Promise<void> {
	let marker = readMarker();
	if (marker?.phase === 'moved') {
		await retireLegacyDatabase();
		return;
	}
	const keyringNamesLegacy = readStoredProfiles().some(
		(profile) => profile.id === LEGACY_WORKSPACE_ID
	);
	if (!marker && !keyringNamesLegacy && localStorage.getItem(MOVE_DONE_KEY)) return;
	if (!marker && (await legacyDatabaseExists()) === false) {
		// Nothing to copy. A keyring entry for it named an empty workspace.
		if (keyringNamesLegacy) {
			const to = randomOpaqueId();
			adoptInKeyring(to);
			moveMirrors(to);
		}
		finish();
		return;
	}

	const legacy = await openDB(LEGACY_DB_NAME);
	try {
		if (!marker && !keyringNamesLegacy && !(await legacyHasData(legacy))) {
			legacy.close();
			await retireLegacyDatabase();
			return;
		}
		marker ??= { to: randomOpaqueId(), phase: 'copying' };
		writeMarker(marker);
		await copyStores(legacy, await getDB(marker.to));
	} finally {
		legacy.close();
	}
	adoptInKeyring(marker.to);
	moveMirrors(marker.to);
	writeMarker({ to: marker.to, phase: 'moved' });
	await retireLegacyDatabase();
}

/**
 * Turn the old default workspace into an ordinary one, once per device. Runs
 * before anything opens a workspace database, one window at a time.
 */
export async function moveLegacyWorkspace(): Promise<void> {
	if (typeof indexedDB === 'undefined' || typeof localStorage === 'undefined') return;
	const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
	if (locks?.request) await locks.request(MOVE_LOCK, moveLocked);
	else await moveLocked();
}
