import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import {
	DeleteBlockedError,
	getAllNotesMetadata,
	getDeviceState,
	getRegisteredWorkspaces,
	getSyncOutboxKeys,
	getSyncState,
	LS_PROFILES,
	putNote,
	readStoredProfiles,
	resolveDbName,
	setDeviceState
} from '$lib/db/idb';
import {
	LEGACY_DB_NAME,
	LEGACY_WORKSPACE_ID,
	MOVE_DONE_KEY,
	MOVE_RECORD_KEY,
	moveLegacyWorkspace
} from './workspaceMove';
import { getLastActiveProfileId } from './profiles';
import type { Note } from './types';

function note(id: string): Note {
	return {
		id,
		title: id,
		body: '',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: []
	};
}

/** The old default workspace as a pre-move build left it. */
async function seedLegacy(
	notes: Note[],
	state: Record<string, unknown> = {},
	outbox: Record<string, number> = {}
): Promise<void> {
	const db = await openDB(LEGACY_DB_NAME, 6, {
		upgrade(database) {
			database.createObjectStore('notes', { keyPath: 'id' });
			database.createObjectStore('labels', { keyPath: 'id' });
			database.createObjectStore('note-images');
			database.createObjectStore('link-previews', { keyPath: 'url' });
			database.createObjectStore('sync-state');
			database.createObjectStore('sync-outbox');
		}
	});
	for (const item of notes) await db.put('notes', item);
	await db.put('note-images', { mime: 'image/png', bytes: new Uint8Array([1, 2]) }, 'n1::pic');
	for (const [key, value] of Object.entries(state)) await db.put('sync-state', value, key);
	for (const [key, generation] of Object.entries(outbox))
		await db.put('sync-outbox', generation, key);
	db.close();
}

function legacyKeyring(syncKey = ''): void {
	localStorage.setItem(
		LS_PROFILES,
		JSON.stringify([{ id: LEGACY_WORKSPACE_ID, name: 'Home', syncKey, createdAt: 0 }])
	);
	localStorage.setItem('scrapscache-last-active-profile', LEGACY_WORKSPACE_ID);
}

async function databaseNames(): Promise<string[]> {
	return (await indexedDB.databases()).flatMap((database) =>
		database.name ? [database.name] : []
	);
}

function movedId(): string {
	const [moved] = readStoredProfiles();
	expect(moved.id).not.toBe(LEGACY_WORKSPACE_ID);
	return moved.id;
}

/** Web Locks as the browser grants them: one holder at a time, in request order. */
function serialLocks() {
	let chain: Promise<unknown> = Promise.resolve();
	return {
		request: <T>(_name: string, run: () => Promise<T>): Promise<T> => {
			const held = chain.then(run);
			chain = held.catch(() => undefined);
			return held;
		}
	};
}

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('moving the old default workspace', () => {
	it('turns it into an ordinary workspace with its notes, sync state and outbox', async () => {
		await seedLegacy(
			[note('n1'), note('n2')],
			{
				'scrapscache-sync-cursor:account': 42,
				'scrapscache-sync-record-fingerprints:account': { 'note:n1': 'fp' },
				'scrapscache-idb-note-tombstones': { gone: 5 }
			},
			{ 'note:n2': 3 }
		);
		legacyKeyring('sync-key');
		localStorage.setItem('scrapscache-notes-mirror', '[{"id":"n1"}]');
		localStorage.setItem('scrapscache-sync-status:device-local', '{"lastSync":9}');

		await moveLegacyWorkspace();

		const id = movedId();
		expect(readStoredProfiles()).toEqual([{ id, name: 'Home', syncKey: 'sync-key', createdAt: 0 }]);
		expect(getLastActiveProfileId()).toBe(id);
		expect((await getAllNotesMetadata(id)).map((item) => item.id).sort()).toEqual(['n1', 'n2']);
		// The cursor and baseline come along, so the workspace neither re-downloads nor re-uploads.
		expect(await getSyncState(id, 'scrapscache-sync-cursor:account')).toBe(42);
		expect(await getSyncState(id, 'scrapscache-sync-record-fingerprints:account')).toEqual({
			'note:n1': 'fp'
		});
		expect(await getSyncState(id, 'scrapscache-idb-note-tombstones')).toEqual({ gone: 5 });
		expect(await getSyncOutboxKeys(id)).toEqual(['note:n2']);
		expect(localStorage.getItem(`scrapscache-notes-mirror:${id}`)).toBe('[{"id":"n1"}]');
		expect(localStorage.getItem('scrapscache-notes-mirror')).toBeNull();
		expect(localStorage.getItem(`scrapscache-sync-status:${id}`)).toBe('{"lastSync":9}');
		expect(await databaseNames()).not.toContain(LEGACY_DB_NAME);
		expect(await getRegisteredWorkspaces()).toEqual([expect.objectContaining({ id })]);
		expect(await getDeviceState(MOVE_RECORD_KEY)).toEqual({ to: id, phase: 'copied' });
		expect(localStorage.getItem(MOVE_DONE_KEY)).toBe('1');
	});

	it('moves an install that predates the keyring into a private workspace', async () => {
		await seedLegacy([note('old')]);

		await moveLegacyWorkspace();

		const [moved] = readStoredProfiles();
		expect(moved).toMatchObject({ syncKey: '', createdAt: 0 });
		expect((await getAllNotesMetadata(moved.id)).map((item) => item.id)).toEqual(['old']);
	});

	it('leaves a device with nothing to move as it was', async () => {
		await moveLegacyWorkspace();

		expect(readStoredProfiles()).toEqual([]);
		expect(await databaseNames()).not.toContain(LEGACY_DB_NAME);
		expect(localStorage.getItem(MOVE_DONE_KEY)).toBe('1');
	});

	it('renames a keyring entry whose database is already gone', async () => {
		legacyKeyring();

		await moveLegacyWorkspace();

		expect(readStoredProfiles()).toEqual([expect.objectContaining({ name: 'Home', syncKey: '' })]);
		movedId();
	});

	it('resumes an interrupted move under the id it started with', async () => {
		await seedLegacy([note('n1')]);
		legacyKeyring();
		await setDeviceState(MOVE_RECORD_KEY, { to: 'started', phase: 'copying' });

		await moveLegacyWorkspace();

		expect(readStoredProfiles().map((profile) => profile.id)).toEqual(['started']);
		expect((await getAllNotesMetadata('started')).map((item) => item.id)).toEqual(['n1']);
	});

	it('finishes deleting the old database on a later boot when another window held it', async () => {
		await seedLegacy([note('n1')]);
		legacyKeyring();
		const holder = await openDB(LEGACY_DB_NAME);

		await moveLegacyWorkspace();

		const id = movedId();
		expect((await getAllNotesMetadata(id)).map((item) => item.id)).toEqual(['n1']);
		expect(await getDeviceState(MOVE_RECORD_KEY)).toEqual({ to: id, phase: 'copied' });

		holder.close();
		await moveLegacyWorkspace().catch((error: unknown) => {
			if (!(error instanceof DeleteBlockedError)) throw error;
		});
		await vi.waitFor(async () => expect(await databaseNames()).not.toContain(LEGACY_DB_NAME));
		expect(readStoredProfiles().map((profile) => profile.id)).toEqual([id]);
	});

	it('moves once when two windows boot together', async () => {
		vi.stubGlobal('navigator', { ...navigator, locks: serialLocks() });
		await seedLegacy([note('n1')]);
		legacyKeyring();

		await Promise.all([moveLegacyWorkspace(), moveLegacyWorkspace()]);

		expect(readStoredProfiles()).toHaveLength(1);
		const id = movedId();
		expect(
			(await databaseNames()).filter((name) => name.startsWith('scrapscache-profile-'))
		).toEqual([resolveDbName(id)]);
	});

	// Browsers flush localStorage lazily, so one killed right after the move can
	// come back with the old keyring while IndexedDB kept the copy.
	function forgetLocalStorage(snapshot: Record<string, string>): void {
		localStorage.clear();
		for (const [key, value] of Object.entries(snapshot)) localStorage.setItem(key, value);
	}
	function localStorageSnapshot(): Record<string, string> {
		return Object.fromEntries(
			Array.from({ length: localStorage.length }, (_, index) => {
				const key = localStorage.key(index) as string;
				return [key, localStorage.getItem(key) as string];
			})
		);
	}
	async function profileDatabases(): Promise<string[]> {
		return (await databaseNames()).filter((name) => name.startsWith('scrapscache-profile-'));
	}

	it('keeps one copy, and what was written to it, when the browser forgot the keyring change', async () => {
		await seedLegacy([note('n1')]);
		legacyKeyring('sync-key');
		localStorage.setItem('scrapscache-notes-mirror', '[{"id":"n1"}]');
		const before = localStorageSnapshot();
		await moveLegacyWorkspace();
		const id = movedId();
		await putNote(id, { ...note('written-after-the-move'), updatedAt: 2 });

		// Killed before either the keyring or the old database's deletion reached disk.
		forgetLocalStorage(before);
		await seedLegacy([note('n1')]);
		await moveLegacyWorkspace();

		expect(readStoredProfiles()).toEqual([{ id, name: 'Home', syncKey: 'sync-key', createdAt: 0 }]);
		expect(await profileDatabases()).toEqual([resolveDbName(id)]);
		expect((await getAllNotesMetadata(id)).map((item) => item.id).sort()).toEqual([
			'n1',
			'written-after-the-move'
		]);
		expect(await databaseNames()).not.toContain(LEGACY_DB_NAME);
	});

	it('does not open an empty workspace when the old database is gone but the keyring still names it', async () => {
		await seedLegacy([note('n1')]);
		legacyKeyring('sync-key');
		const before = localStorageSnapshot();
		await moveLegacyWorkspace();
		const id = movedId();

		// The deletion reached disk; the keyring change did not.
		forgetLocalStorage(before);
		await moveLegacyWorkspace();

		expect(readStoredProfiles().map((profile) => profile.id)).toEqual([id]);
		expect(await profileDatabases()).toEqual([resolveDbName(id)]);
		expect((await getAllNotesMetadata(id)).map((item) => item.id)).toEqual(['n1']);
	});
});
