/**
 * Closing and deleting a database are the two moments a queued write can be
 * lost, and the two moments a caller can be told their data is gone while it
 * is still on the device. Both are checked here rather than trusted to the
 * callers that happen to await the right thing.
 */

import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import {
	closeDeviceDatabase,
	DeleteBlockedError,
	DEVICE_DB_NAME,
	setRegisteredWorkspaces,
	deleteProfileDatabase,
	deleteStoredProfile,
	dropDatabase,
	getAllLabels,
	getAllNotesMetadata,
	getSyncState,
	isProfileReleased,
	putLabel,
	putNote,
	putStoredProfile,
	readStoredProfiles,
	releaseProfile,
	resolveDbName,
	resumeProfile
} from './idb';
import type { Label, Note } from '$lib/types';
import { TEST_WORKSPACE } from '../../tests/workspace';

const PROFILE = 'workspace-lifecycle';
const PROFILE_DB = resolveDbName(PROFILE);

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

function label(id: string): Label {
	return { id, name: id, createdAt: 1, updatedAt: 1 };
}

async function databaseNames(): Promise<string[]> {
	const databases = await indexedDB.databases();
	return databases.map((entry) => entry.name).filter((name): name is string => !!name);
}

describe('closeDeviceDatabase', () => {
	it('lets a write that was never awaited finish before closing', async () => {
		// The stores queue writes and move on, so the close has to cover them.
		void putNote(PROFILE, note('unawaited'));
		void putLabel(PROFILE, label('unawaited-tag'));

		await closeDeviceDatabase();

		expect((await getAllNotesMetadata(PROFILE)).map((item) => item.id)).toEqual(['unawaited']);
		expect((await getAllLabels(PROFILE)).map((item) => item.id)).toEqual(['unawaited-tag']);
	});

	it('leaves no connection of its own behind for a delete to trip over', async () => {
		await putNote(PROFILE, note('kept'));

		await closeDeviceDatabase();
		await dropDatabase(PROFILE_DB);

		expect(await databaseNames()).not.toContain(PROFILE_DB);
	});
});

describe('dropDatabase', () => {
	it('waits out a blocked delete instead of reporting success early', async () => {
		await putNote(PROFILE, note('blocking'));
		await closeDeviceDatabase();
		// A connection this module does not own, as another tab would hold.
		const other = await openDB(PROFILE_DB);

		let settled = false;
		const deletion = dropDatabase(PROFILE_DB).then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		other.close();
		await deletion;

		expect(settled).toBe(true);
		expect(await databaseNames()).not.toContain(PROFILE_DB);
	});

	it('fails when the block never clears, rather than claiming the data is gone', async () => {
		await putNote(PROFILE, note('stuck'));
		await closeDeviceDatabase();
		const other = await openDB(PROFILE_DB);

		try {
			const failure = await dropDatabase(PROFILE_DB, 20).catch((error: Error) => error);

			expect(failure).toBeInstanceOf(Error);
			expect((failure as Error).message).toMatch(/still open/);
			// The name a database is built from carries the workspace id.
			expect((failure as Error).message).not.toContain(PROFILE);
			expect(await databaseNames()).toContain(PROFILE_DB);
		} finally {
			other.close();
		}
	});

	// The browser cannot call a delete off. Past the grace it is still queued, and
	// it lands the moment the last connection closes.
	it('still reports when a delete it stopped waiting on finally lands', async () => {
		await putNote(PROFILE, note('put-off'));
		await closeDeviceDatabase();
		const other = await openDB(PROFILE_DB);

		const failure = await dropDatabase(PROFILE_DB, 20).catch((error: Error) => error);
		expect(failure).toBeInstanceOf(DeleteBlockedError);

		other.close();
		await (failure as DeleteBlockedError).completion;

		expect(await databaseNames()).not.toContain(PROFILE_DB);
	});
});

describe('deleteProfileDatabase', () => {
	it('removes the workspace database once its queued writes have landed', async () => {
		void putNote(PROFILE, note('in-flight'));

		await deleteProfileDatabase(PROFILE);

		expect(await databaseNames()).not.toContain(PROFILE_DB);
	});

	it('leaves every other workspace and the device database alone', async () => {
		await putNote(TEST_WORKSPACE, note('other'));
		await putNote(PROFILE, note('scoped'));
		await setRegisteredWorkspaces([
			{ id: TEST_WORKSPACE, syncKey: '' },
			{ id: PROFILE, syncKey: '' }
		]);

		await deleteProfileDatabase(PROFILE);

		expect(await databaseNames()).toContain(DEVICE_DB_NAME);
		expect((await getAllNotesMetadata(TEST_WORKSPACE)).map((item) => item.id)).toEqual(['other']);
	});
});

describe('deleteStoredProfile', () => {
	it('takes the workspace off the keyring once its data is gone', async () => {
		await putStoredProfile({ id: PROFILE, name: 'Removed', syncKey: '', createdAt: 1 });
		await putNote(PROFILE, note('removed'));

		await deleteStoredProfile(PROFILE);

		expect(readStoredProfiles().map((entry) => entry.id)).not.toContain(PROFILE);
		expect(await databaseNames()).not.toContain(PROFILE_DB);
	});

	// The keyring entry is the only way back to a workspace's database. Removed
	// while the data stayed, it would leave every note on the device with nothing
	// able to reach or remove it; kept after the data went, it would name nothing.
	it('keeps the keyring entry while a delete is held up, and drops it when it lands', async () => {
		await putStoredProfile({ id: PROFILE, name: 'Held up', syncKey: '', createdAt: 1 });
		await putNote(PROFILE, note('kept-for-now'));
		await closeDeviceDatabase();
		// A connection this module does not own, as another tab would hold.
		const other = await openDB(PROFILE_DB);

		const failure = await deleteStoredProfile(PROFILE).catch((error: Error) => error);

		expect(failure).toBeInstanceOf(DeleteBlockedError);
		expect(readStoredProfiles().map((entry) => entry.id)).toContain(PROFILE);
		expect(await databaseNames()).toContain(PROFILE_DB);

		other.close();
		await (failure as DeleteBlockedError).completion;
		await Promise.resolve();

		expect(readStoredProfiles().map((entry) => entry.id)).not.toContain(PROFILE);
		expect(await databaseNames()).not.toContain(PROFILE_DB);
	});
});

describe('releasing a workspace another window removed', () => {
	it('refuses to open it again, and leaves the shared device database alone', async () => {
		await putNote(PROFILE, note('released'));
		await putNote(TEST_WORKSPACE, note('device'));

		releaseProfile(PROFILE);

		await expect(getAllNotesMetadata(PROFILE)).rejects.toThrow(/no longer on this device/);
		expect((await getAllNotesMetadata(TEST_WORKSPACE)).map((item) => item.id)).toEqual(['device']);
	});

	it('serves it again once a keyring entry names it', async () => {
		await putNote(PROFILE, note('restored'));

		releaseProfile(PROFILE);
		resumeProfile(PROFILE);

		expect((await getAllNotesMetadata(PROFILE)).map((item) => item.id)).toEqual(['restored']);
	});

	// Without this the delete waits out its whole grace and fails, and the user
	// is told a workspace could not be removed with no way to see why.
	it('steps out of the way of a delete another window started', async () => {
		await putNote(PROFILE, note('holding'));

		await dropDatabase(PROFILE_DB, 50);

		expect(await databaseNames()).not.toContain(PROFILE_DB);
		expect(isProfileReleased(PROFILE)).toBe(true);
	});

	// The keyring still names a workspace until its delete lands. Serving it again
	// on that word would let a queued write rebuild the database behind the delete.
	it('keeps refusing a workspace whose delete was asked for, whatever the keyring says', async () => {
		await putNote(PROFILE, note('holding'));
		await dropDatabase(PROFILE_DB, 50);

		resumeProfile(PROFILE);

		expect(isProfileReleased(PROFILE)).toBe(true);
		await expect(getAllNotesMetadata(PROFILE)).rejects.toThrow(/no longer on this device/);
		expect(await databaseNames()).not.toContain(PROFILE_DB);
	});
});

describe('workspace database v7', () => {
	it('moves state an earlier version kept as <key>:<workspace id> to plain keys', async () => {
		const pid = 'upgraded';
		const old = await openDB(resolveDbName(pid), 6, {
			upgrade(db) {
				db.createObjectStore('notes', { keyPath: 'id' });
				db.createObjectStore('labels', { keyPath: 'id' });
				db.createObjectStore('note-images');
				db.createObjectStore('sync-state');
				db.createObjectStore('sync-outbox');
			}
		});
		// The suffixed copy was the one kept current; the plain one could be stale.
		await old.put('sync-state', { current: 2 }, `scrapscache-idb-label-tombstones:${pid}`);
		await old.put('sync-state', { stale: 1 }, 'scrapscache-idb-label-tombstones');
		await old.put('sync-state', [{ id: 'star' }], `scrapscache-canvas-library:${pid}`);
		await old.put('sync-state', 7, 'scrapscache-sync-cursor:account');
		old.close();

		expect(await getSyncState(pid, 'scrapscache-idb-label-tombstones')).toEqual({ current: 2 });
		expect(await getSyncState(pid, 'scrapscache-canvas-library')).toEqual([{ id: 'star' }]);
		expect(await getSyncState(pid, 'scrapscache-sync-cursor:account')).toBe(7);
		expect(await getSyncState(pid, `scrapscache-idb-label-tombstones:${pid}`)).toBeUndefined();
	});
});
