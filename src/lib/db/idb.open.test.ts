/**
 * Opening a workspace database while other windows hold it. An older window
 * that never lets go used to hang every newer one forever; a newer window's
 * upgrade used to be blocked by this one; and a connection the browser closed
 * on its own was served again as if it were open.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDB, unwrap } from 'idb';
import { forceCloseDatabase } from 'fake-indexeddb';
import { getAllNotesMetadata, getDB, onWorkspaceOutdated, putNote, resolveDbName } from './idb';
import type { Note } from '#lib/types.js';

const PROFILE = 'workspace-open';
const PROFILE_DB = resolveDbName(PROFILE);
const CURRENT_VERSION = 7;

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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`still waiting after ${ms}ms`)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

describe('opening a workspace database', () => {
	afterEach(() => {
		onWorkspaceOutdated(() => location.reload());
	});

	it('lets go and reloads when a newer build in another window upgrades the schema', async () => {
		const reload = vi.fn();
		onWorkspaceOutdated(reload);
		await putNote(PROFILE, note('before'));

		// The other window: same name, next version. Without the old window closing
		// its connection, this never resolves.
		const upgraded = await withTimeout(
			openDB(PROFILE_DB, CURRENT_VERSION + 1, { upgrade() {} }),
			2000
		);
		expect(upgraded.version).toBe(CURRENT_VERSION + 1);
		expect(reload).toHaveBeenCalledTimes(1);
		upgraded.close();
	});

	it(
		'gives up with a clear error when an older window never lets go, and recovers once it does',
		{ timeout: 10_000 },
		async () => {
			// An old window: holds the previous version open and ignores the version change.
			const older = await openDB(PROFILE_DB, CURRENT_VERSION - 1);

			// Real time: fake timers would also stall the fake IndexedDB's own scheduling.
			await expect(getDB(PROFILE)).rejects.toThrow(/older version of Scraps Cache/);

			older.close();
			// The next use opens afresh, and the connection from the abandoned open
			// is not left behind to block anyone (the suite's cleanup would say so).
			await putNote(PROFILE, note('after'));
			expect((await getAllNotesMetadata(PROFILE)).map((item) => item.id)).toEqual(['after']);
		}
	);

	it('reopens after the browser closed the connection on its own', async () => {
		const db = await getDB(PROFILE);
		// fake-indexeddb types the parameter as the class rather than an instance.
		forceCloseDatabase(unwrap(db) as unknown as Parameters<typeof forceCloseDatabase>[0]);
		await new Promise((resolve) => setTimeout(resolve, 0));

		await putNote(PROFILE, note('again'));
		expect((await getAllNotesMetadata(PROFILE)).map((item) => item.id)).toEqual(['again']);
	});
});
