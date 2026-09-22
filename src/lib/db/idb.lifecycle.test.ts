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
	DEVICE_DB_NAME,
	deleteProfileDatabase,
	deleteStoredProfile,
	dropDatabase,
	getAllLabels,
	getAllNotesMetadata,
	isProfileReleased,
	LOCAL_PROFILE_ID,
	putLabel,
	putNote,
	putStoredProfile,
	readStoredProfiles,
	releaseProfile,
	resolveDbName,
	resumeProfile
} from './idb';
import type { Label, Note } from '$lib/types';

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
});

describe('deleteProfileDatabase', () => {
	it('removes the workspace database once its queued writes have landed', async () => {
		void putNote(PROFILE, note('in-flight'));

		await deleteProfileDatabase(PROFILE);

		expect(await databaseNames()).not.toContain(PROFILE_DB);
	});

	it('never touches the device database the default workspace shares', async () => {
		await putNote(LOCAL_PROFILE_ID, note('anonymous'));
		await putNote(PROFILE, note('scoped'));

		await deleteProfileDatabase(PROFILE);

		expect(await databaseNames()).toContain(DEVICE_DB_NAME);
		expect((await getAllNotesMetadata(LOCAL_PROFILE_ID)).map((item) => item.id)).toEqual([
			'anonymous'
		]);
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

	// The keyring entry is the only way back to a workspace's database. Removing
	// it ahead of a delete that then fails would leave every note on the device
	// with nothing able to reach or remove it.
	it('leaves the workspace whole when its data could not be deleted', async () => {
		await putStoredProfile({ id: PROFILE, name: 'Stuck', syncKey: '', createdAt: 1 });
		await putNote(PROFILE, note('kept'));
		await closeDeviceDatabase();
		// A connection this module does not own, as another tab would hold.
		const other = await openDB(PROFILE_DB);

		try {
			const failure = await deleteStoredProfile(PROFILE).catch((error: Error) => error);

			expect(failure).toBeInstanceOf(Error);
			expect(readStoredProfiles().map((entry) => entry.id)).toContain(PROFILE);
			expect(await databaseNames()).toContain(PROFILE_DB);
		} finally {
			other.close();
		}
	});
});

describe('releasing a workspace another window removed', () => {
	it('refuses to open it again, and leaves the shared device database alone', async () => {
		await putNote(PROFILE, note('released'));
		await putNote(LOCAL_PROFILE_ID, note('device'));

		releaseProfile(PROFILE);

		await expect(getAllNotesMetadata(PROFILE)).rejects.toThrow(/no longer on this device/);
		expect((await getAllNotesMetadata(LOCAL_PROFILE_ID)).map((item) => item.id)).toEqual([
			'device'
		]);
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
});
