import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/imageThumb.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/imageThumb.js')>();
	return { ...actual, makeImageThumbDataUrl: vi.fn(async () => null) };
});

import { createSyncIdentity, encryptSyncPayload } from '#lib/syncPairing.js';
import { syncControlKeys } from '#lib/syncEngine.js';
import {
	clearSyncOutbox,
	closeDeviceDatabase,
	resolveDbName,
	deleteSyncState,
	getAllNotesMetadata,
	getSyncOutboxKeys,
	getSyncState,
	hydrateNoteAttachments,
	putNote,
	setSyncState
} from '#lib/db/idb.js';
import * as idb from '#lib/db/idb.js';
import { openDB } from 'idb';
import { loadBoardsFromDevice } from '#lib/syncTombstones.js';
import * as syncTombstones from '#lib/syncTombstones.js';
import { writeNotesMirror } from '#lib/noteStorage.js';
import { notesStore } from './notes.svelte';
import { SYNC_LOCK } from './syncScheduler';
import { syncStore } from './sync.svelte';
import { syncSnapshot, type SyncSnapshot } from '#lib/syncRecords.js';
import { mergeTwoNotes } from '#lib/model/index.js';
import type { Note } from '#lib/types.js';
import { linkTestWorkspace, unlinkTestWorkspace } from '../../tests/syncing';
import { emptyWorkspace, TEST_WORKSPACE } from '../../tests/workspace';
import { createKanbanBoard } from '#lib/kanban.js';
import { kanbanStore } from './kanban.svelte';

function remoteNote(id = 'note-1'): Note {
	return {
		id,
		title: 'pulled from relay',
		body: '',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		images: [],
		fieldTimes: {
			title: 1,
			body: 1,
			color: 1,
			pinned: 1,
			archived: 1,
			trashed: 1,
			reminder: 1,
			labels: 1,
			images: 1,
			linkPreviews: 1
		}
	};
}

describe('notes store sync apply', () => {
	it('force push stamps this device’s copy past the cloud’s in one step, and an ordinary sync sends it', async () => {
		const account = linkTestWorkspace();
		const keys = syncControlKeys(account.accountId);
		const local = { ...remoteNote('shared'), title: 'This device wins' };
		// What the window shows plays no part: the copy is taken from the database.
		notesStore.notes = [];
		await putNote(TEST_WORKSPACE, local);
		vi.spyOn(syncStore, 'reauthenticateForRecovery').mockResolvedValue();
		const remote = syncSnapshot({
			notes: [
				{
					...remoteNote('shared'),
					title: 'Cloud loses',
					updatedAt: 5000,
					fieldTimes: { title: 6000 }
				},
				remoteNote('cloud-only')
			]
		});
		const read = vi.spyOn(syncStore, 'readRelay').mockImplementation(async () => {
			// Reading the cloud's copy changes nothing on this device.
			expect(await getSyncState(TEST_WORKSPACE, keys.cursor)).toBeUndefined();
			return {
				success: true,
				snapshot: remote,
				control: { [keys.cursor]: 2, [keys.baseline]: { 'note:shared': 'cloud-fingerprint' } }
			};
		});
		// The upload sends what the database holds by then.
		const sync = vi
			.spyOn(syncStore, 'syncWorkspace')
			.mockImplementation(async (_profile, local) => {
				const { notes, tombstones } = local;
				expect(notes.map((note) => note.title)).toEqual(['This device wins']);
				expect(notes[0].fieldTimes!.title).toBeGreaterThan(6000);
				expect(tombstones['cloud-only']).toBeGreaterThan(6000);
				// The sync state of the copy that was read landed with the notes, and every
				// record is queued: the upload sends what differs without downloading again.
				expect(await getSyncState(TEST_WORKSPACE, keys.cursor)).toBe(2);
				expect(await getSyncState(TEST_WORKSPACE, keys.baseline)).toEqual({
					'note:shared': 'cloud-fingerprint'
				});
				expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(
					expect.arrayContaining(['note:shared', 'note-tombstone:cloud-only'])
				);
				return { success: true, snapshot: local };
			});
		expect(await notesStore.forcePushWorkspace(TEST_WORKSPACE)).toEqual({ success: true });
		expect(read).toHaveBeenCalledOnce();
		expect(sync).toHaveBeenCalled();
		// The window was loaded again from what landed.
		expect(notesStore.notes.map((note) => note.title)).toEqual(['This device wins']);
	});

	it('force push brings back a note the cloud deleted for good under a new id, with its photo', async () => {
		linkTestWorkspace();
		const dataUrl = 'data:image/png;base64,QUJD';
		const kept = {
			...remoteNote('deleted-in-cloud'),
			title: 'Still wanted',
			images: [{ id: 'shot', mime: 'image/png', dataUrl, createdAt: 1 }]
		};
		await putNote(TEST_WORKSPACE, kept);
		vi.spyOn(syncStore, 'reauthenticateForRecovery').mockResolvedValue();
		vi.spyOn(syncStore, 'readRelay').mockResolvedValue({
			success: true,
			snapshot: syncSnapshot({ tombstones: { 'deleted-in-cloud': 9_000 } }),
			control: {}
		});
		vi.spyOn(syncStore, 'syncWorkspace').mockImplementation(async (_profile, local) => ({
			success: true,
			snapshot: local
		}));

		expect(await notesStore.forcePushWorkspace(TEST_WORKSPACE)).toEqual({ success: true });

		// A delete is final for its id: the note returns under another, and its bytes with it.
		expect(notesStore.notes.map((note) => note.title)).toEqual(['Still wanted']);
		const [returned] = notesStore.notes;
		expect(returned.id).not.toBe('deleted-in-cloud');
		expect(notesStore.deletedNoteIds).toHaveProperty('deleted-in-cloud');
		const stored = (await getAllNotesMetadata(TEST_WORKSPACE)).find(
			(note) => note.id === returned.id
		);
		const hydrated = await hydrateNoteAttachments(TEST_WORKSPACE, stored!);
		expect(hydrated.images?.map((image) => image.dataUrl)).toEqual([dataUrl]);
		expect(hydrated.images?.[0].id).not.toBe('shot');
		// Nothing is left behind under the old id.
		expect((await getAllNotesMetadata(TEST_WORKSPACE)).map((note) => note.id)).toEqual([
			returned.id
		]);
	});

	// The copy that lands was made from what the database held a moment before. An
	// edit saved in between, by this window or another, must not be gone over.
	it('force push plans again when something is saved between its read and its landing', async () => {
		linkTestWorkspace();
		const local = { ...remoteNote('edited-meanwhile'), title: 'Before' };
		await putNote(TEST_WORKSPACE, local);
		vi.spyOn(syncStore, 'reauthenticateForRecovery').mockResolvedValue();
		vi.spyOn(syncStore, 'readRelay').mockResolvedValue({
			success: true,
			snapshot: syncSnapshot(),
			control: {}
		});
		vi.spyOn(syncStore, 'syncWorkspace').mockImplementation(async (_profile, local) => ({
			success: true,
			snapshot: local
		}));
		const rewrite = idb.rewriteWorkspace;
		const landing = vi.spyOn(idb, 'rewriteWorkspace').mockImplementationOnce(async (...args) => {
			// Another window saves the note after the plan read it.
			await idb.saveNote(
				TEST_WORKSPACE,
				{ ...local, title: 'Edited meanwhile', fieldTimes: { ...local.fieldTimes, title: 9 } },
				['note:edited-meanwhile']
			);
			return rewrite(...args);
		});

		expect(await notesStore.forcePushWorkspace(TEST_WORKSPACE)).toEqual({ success: true });

		expect(landing).toHaveBeenCalledTimes(2);
		expect((await getAllNotesMetadata(TEST_WORKSPACE)).map((note) => note.title)).toEqual([
			'Edited meanwhile'
		]);
	});

	it('leaves local data unchanged when recovery authentication fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		linkTestWorkspace();
		const local = remoteNote('unchanged');
		notesStore.notes = [local];
		await putNote(TEST_WORKSPACE, local);
		vi.spyOn(syncStore, 'reauthenticateForRecovery').mockRejectedValue(
			new Error('Server unavailable')
		);
		const read = vi.spyOn(syncStore, 'readRelay');
		expect(await notesStore.forcePushWorkspace(TEST_WORKSPACE)).toEqual({
			success: false,
			error: 'Server unavailable'
		});
		expect(read).not.toHaveBeenCalled();
		expect((await getAllNotesMetadata(TEST_WORKSPACE))[0].updatedAt).toBe(1);
		expect(notesStore.notes[0].title).toBe(local.title);
	});

	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllTimers();
		vi.useRealTimers();
		localStorage.clear();
		notesStore.notes = [];
		notesStore.loaded = true;
		notesStore.labels = [];
		notesStore.deletedNoteIds = {};
		notesStore.deletedLabelIds = {};
		notesStore.lastPersistError = null;
		unlinkTestWorkspace();
		vi.restoreAllMocks();
	});

	afterEach(() => {
		unlinkTestWorkspace();
		notesStore.notes = [];
		notesStore.loaded = true;
		notesStore.labels = [];
	});

	it('persists pulled notes and boards to IndexedDB before committing the cursor', async () => {
		const account = createSyncIdentity();
		linkTestWorkspace(account.syncKey);
		const keys = syncControlKeys(account.accountId);
		const pulled = remoteNote();
		const pulledBoard = { ...createKanbanBoard('Pulled board'), id: 'pulled-board' };

		vi.spyOn(
			syncStore as unknown as {
				sendSyncRequest(
					path: string,
					payload: string
				): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
			},
			'sendSyncRequest'
		).mockImplementation(async (_path, payload) => {
			const request = JSON.parse(payload) as { cursor: number };
			if (request.cursor === 0) {
				return {
					success: true,
					data: {
						cursor: 1,
						envelopes: [
							{
								seq: 1,
								id: 'remote-id',
								slot: 'a'.repeat(64),
								ciphertext: encryptSyncPayload(
									account.syncKey,
									{
										kind: 'note',
										value: pulled
									},
									'a'.repeat(64)
								)
							},
							{
								seq: 2,
								id: 'remote-board-id',
								slot: 'b'.repeat(64),
								ciphertext: encryptSyncPayload(
									account.syncKey,
									{ kind: 'board', value: pulledBoard },
									'b'.repeat(64)
								)
							}
						],
						conflicts: [],
						hasMore: false,
						reset: false,
						writesAccepted: true
					}
				};
			}
			return {
				success: true,
				data: {
					cursor: 1,
					envelopes: [],
					conflicts: [],
					hasMore: false,
					reset: false,
					writesAccepted: true
				}
			};
		});

		expect(await notesStore.syncWithCloudManual()).toBe(true);
		expect(notesStore.lastPersistError).toBeNull();
		expect(
			(await getAllNotesMetadata(TEST_WORKSPACE)).map(({ id, title }) => ({ id, title }))
		).toEqual([{ id: 'note-1', title: 'pulled from relay' }]);
		expect(await getSyncState(TEST_WORKSPACE, keys.cursor)).toBe(1);
		const boards = await loadBoardsFromDevice<Array<{ id: string }>>(TEST_WORKSPACE, []);
		expect(boards.map((board) => board.id)).toContain('pulled-board');
		// The window shows it too.
		expect(kanbanStore.boards.map((board) => board.id)).toContain('pulled-board');
	});

	it('replays a mirrored note that never reached IndexedDB', async () => {
		const kept = remoteNote('kept');
		kept.title = 'already on disk';
		const lost = remoteNote('lost');
		lost.title = 'only in the mirror';
		lost.updatedAt = 2;
		await putNote(TEST_WORKSPACE, kept);
		writeNotesMirror([kept, lost], TEST_WORKSPACE);
		notesStore.notes = [];
		notesStore.loaded = true;
		notesStore.labels = [];
		notesStore.loaded = false;
		notesStore.deletedNoteIds = {};
		notesStore.deletedLabelIds = {};

		await notesStore.init();

		expect((await getAllNotesMetadata(TEST_WORKSPACE)).map(({ id }) => id).sort()).toEqual([
			'kept',
			'lost'
		]);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toContain('note:lost');
	});

	it('does not re-enter the web lock during a relay-reset bootstrap', async () => {
		const account = createSyncIdentity();
		linkTestWorkspace(account.syncKey);
		let depth = 0;
		let maxDepth = 0;
		const locks = {
			request: async (name: string, ...rest: unknown[]) => {
				const callback = rest.at(-1) as () => Promise<boolean>;
				// Only the sync lock is under test; the others are theirs to take.
				if (name !== `${SYNC_LOCK}:${TEST_WORKSPACE}`) return callback();
				depth += 1;
				maxDepth = Math.max(maxDepth, depth);
				try {
					return await callback();
				} finally {
					depth -= 1;
				}
			}
		};
		Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
		vi.spyOn(
			syncStore as unknown as {
				sendSyncRequest(
					path: string,
					payload: string
				): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
			},
			'sendSyncRequest'
		).mockImplementation(async (_path, payload) => {
			const request = JSON.parse(payload) as { cursor: number };
			if (request.cursor > 0) {
				return {
					success: true,
					data: {
						cursor: 0,
						envelopes: [],
						conflicts: [],
						hasMore: false,
						reset: true,
						writesAccepted: false
					}
				};
			}
			return {
				success: true,
				data: {
					cursor: 0,
					envelopes: [],
					conflicts: [],
					hasMore: false,
					reset: false,
					writesAccepted: true
				}
			};
		});
		const keys = syncControlKeys(account.accountId);
		await setSyncState(TEST_WORKSPACE, keys.cursor, 99);
		await setSyncState(TEST_WORKSPACE, keys.baseline, { 'note:note-1': 'stale' });

		try {
			expect(await notesStore.syncWithCloudManual()).toBe(true);
			expect(maxDepth).toBe(1);
		} finally {
			Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
		}
	});

	it('writes the delete tombstone even when the IndexedDB delete fails', async () => {
		const doomed = remoteNote('gone');
		await putNote(TEST_WORKSPACE, doomed);
		notesStore.notes = [doomed];
		vi.spyOn(idb, 'deleteNote').mockRejectedValueOnce(new Error('IndexedDB delete failed'));
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await notesStore.deleteNoteForever('gone');
		error.mockRestore();

		expect(notesStore.deletedNoteIds.gone).toBeGreaterThan(0);
		expect(await getSyncState(TEST_WORKSPACE, 'scrapscache-idb-note-tombstones')).toMatchObject({
			gone: expect.any(Number)
		});
		expect((await getAllNotesMetadata(TEST_WORKSPACE)).map(({ id }) => id)).toContain('gone');
	});

	it('keeps trashed notes in memory when the tombstone write fails', async () => {
		const doomed = remoteNote('doomed');
		doomed.trashed = true;
		doomed.trashedAt = Date.now();
		notesStore.notes = [doomed];
		vi.spyOn(syncTombstones, 'addTombstones').mockRejectedValueOnce(
			new Error('tombstone write failed')
		);
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		notesStore.emptyTrash();
		await new Promise((resolve) => setTimeout(resolve, 0));
		error.mockRestore();

		expect(notesStore.notes.map((item) => item.id)).toEqual(['doomed']);
		expect(notesStore.deletedNoteIds.doomed).toBeUndefined();
	});

	it('reattaches photo blobs after a crash between blob write and note commit', async () => {
		await getAllNotesMetadata(TEST_WORKSPACE);
		await closeDeviceDatabase();
		const db = await openDB(resolveDbName(TEST_WORKSPACE));
		await db.put(
			'note-images',
			{ mime: 'image/png', bytes: Uint8Array.from([65]), hash: 'hash-pic' },
			'lost::pic'
		);
		db.close();
		await closeDeviceDatabase();

		const lost = remoteNote('lost');
		lost.images = [
			{
				id: 'pic',
				mime: 'image/png',
				dataUrl: '',
				createdAt: 1,
				contentHash: 'hash-pic'
			}
		];
		writeNotesMirror([lost], TEST_WORKSPACE);
		notesStore.notes = [];
		notesStore.loaded = true;
		notesStore.loaded = false;

		await notesStore.init();

		const stored = (await getAllNotesMetadata(TEST_WORKSPACE)).find((item) => item.id === 'lost');
		expect(stored).toBeDefined();
		const hydrated = await hydrateNoteAttachments(TEST_WORKSPACE, stored!);
		expect(hydrated.images?.[0]?.dataUrl?.startsWith('data:image/png')).toBe(true);
	});

	it('restores photo bytes from the relay after IndexedDB is wiped', async () => {
		const account = createSyncIdentity();
		linkTestWorkspace(account.syncKey);
		const image = {
			id: 'pic',
			mime: 'image/png',
			dataUrl: 'data:image/png;base64,QQ==',
			createdAt: 1,
			contentHash: 'hash-pic'
		};
		notesStore.notes = [
			{
				...remoteNote(),
				images: [{ ...image, dataUrl: '' }]
			}
		];
		const keys = syncControlKeys(account.accountId);
		await emptyWorkspace(TEST_WORKSPACE);
		await clearSyncOutbox(TEST_WORKSPACE, await getSyncOutboxKeys(TEST_WORKSPACE));
		await deleteSyncState(TEST_WORKSPACE, keys.cursor);
		await deleteSyncState(TEST_WORKSPACE, keys.baseline);
		await deleteSyncState(TEST_WORKSPACE, keys.recordIds);

		vi.spyOn(
			syncStore as unknown as {
				sendSyncRequest(
					path: string,
					payload: string
				): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
			},
			'sendSyncRequest'
		).mockImplementation(async (_path, payload) => {
			const request = JSON.parse(payload) as { cursor: number };
			if (request.cursor === 0) {
				return {
					success: true,
					data: {
						cursor: 2,
						envelopes: [
							{
								seq: 1,
								id: 'att-id',
								slot: 'a'.repeat(64),
								ciphertext: encryptSyncPayload(
									account.syncKey,
									{
										kind: 'attachment',
										value: {
											id: 'pic',
											mime: 'image/png',
											createdAt: 1,
											hash: 'hash-pic',
											dataUrl: image.dataUrl
										}
									},
									'a'.repeat(64)
								)
							},
							{
								seq: 2,
								id: 'note-id',
								slot: 'b'.repeat(64),
								ciphertext: encryptSyncPayload(
									account.syncKey,
									{
										kind: 'note',
										value: {
											...remoteNote(),
											images: [
												{
													id: 'pic',
													mime: 'image/png',
													createdAt: 1,
													hash: 'hash-pic'
												}
											]
										}
									},
									'b'.repeat(64)
								)
							}
						],
						conflicts: [],
						hasMore: false,
						reset: false,
						writesAccepted: true
					}
				};
			}
			return {
				success: true,
				data: {
					cursor: 2,
					envelopes: [],
					conflicts: [],
					hasMore: false,
					reset: false,
					writesAccepted: true
				}
			};
		});

		expect(await notesStore.syncWithCloudManual()).toBe(true);
		const stored = (await getAllNotesMetadata(TEST_WORKSPACE)).find((item) => item.id === 'note-1');
		expect(stored).toBeDefined();
		const hydrated = await hydrateNoteAttachments(TEST_WORKSPACE, stored!);
		expect(hydrated.images?.[0]?.dataUrl).toBe(image.dataUrl);
	});
});

// A sync saves into the database while a window that has not been shown the result
// yet goes on editing its older copy. Every save merges with what is stored, so
// neither goes over the other, and showing the result writes nothing.
describe('edits made while a sync saves', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		unlinkTestWorkspace();
		notesStore.notes = [];
		notesStore.labels = [];
		notesStore.loaded = true;
	});

	const show = (snapshot: SyncSnapshot) =>
		(
			notesStore as unknown as {
				show(
					pid: string,
					synced: { snapshot: SyncSnapshot; decisions: Map<string, unknown> }
				): Promise<void>;
			}
		).show(TEST_WORKSPACE, { snapshot, decisions: new Map() });

	it('keeps what a sync saved when an edit of the older copy is saved after it', async () => {
		linkTestWorkspace();
		notesStore.loaded = true;
		await emptyWorkspace(TEST_WORKSPACE);
		const before = remoteNote('racing');
		notesStore.notes = [before];
		await putNote(TEST_WORKSPACE, before);
		// A sync saves a title another device wrote. The window has not been shown it.
		const pulled = { ...before, title: 'renamed elsewhere', updatedAt: 5 };
		pulled.fieldTimes = { ...before.fieldTimes, title: 5 };
		const saved = await idb.mergeNote(TEST_WORKSPACE, pulled, (stored) =>
			mergeTwoNotes(stored!, pulled)
		);

		notesStore.updateNote('racing', { pinned: true });
		await idb.waitForDeviceWrites(TEST_WORKSPACE);

		const stored = () =>
			getAllNotesMetadata(TEST_WORKSPACE).then((notes) =>
				notes.find((note) => note.id === 'racing')
			);
		expect(await stored()).toMatchObject({ title: 'renamed elsewhere', pinned: true });
		// The edit is queued to upload with what it was merged into.
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toContain('note:racing');

		const put = vi.spyOn(idb, 'putNote');
		const save = vi.spyOn(idb, 'saveNote');
		await show(syncSnapshot({ notes: [saved!] }));
		await idb.waitForDeviceWrites(TEST_WORKSPACE);

		expect(notesStore.notes[0]).toMatchObject({ title: 'renamed elsewhere', pinned: true });
		expect(put).not.toHaveBeenCalled();
		expect(save).not.toHaveBeenCalled();
		expect(await stored()).toMatchObject({ title: 'renamed elsewhere', pinned: true });
	});

	it('tries a label save that failed again, and its delete too', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		try {
			vi.spyOn(idb, 'saveLabel').mockRejectedValueOnce(new Error('Storage full'));
			const label = notesStore.createLabel('Kept after a failed save')!;
			await vi.waitFor(() => expect(notesStore.lastPersistError).toMatch(/Could not save label/));
			expect(await idb.getAllLabels(TEST_WORKSPACE)).toEqual([]);

			await vi.advanceTimersByTimeAsync(1_000);
			await vi.waitFor(async () =>
				expect((await idb.getAllLabels(TEST_WORKSPACE)).map(({ id }) => id)).toEqual([label.id])
			);
			expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toContain(`label:${label.id}`);

			vi.spyOn(syncTombstones, 'deleteLabelWithTombstone').mockRejectedValueOnce(
				new Error('Storage full')
			);
			notesStore.removeLabel(label.id);
			await vi.waitFor(() => expect(notesStore.lastPersistError).toMatch(/Could not delete label/));
			await vi.advanceTimersByTimeAsync(1_000);
			await vi.waitFor(async () => expect(await idb.getAllLabels(TEST_WORKSPACE)).toEqual([]));
			expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toContain(`label-tombstone:${label.id}`);
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps the later rename of a label, whichever of the two is saved last', async () => {
		const label = { id: 'renamed', name: 'Before', createdAt: 1, updatedAt: 1 };
		await idb.saveLabel(TEST_WORKSPACE, label);
		// A sync saved a rename from another device; this window saves an earlier one after it.
		await idb.saveLabel(TEST_WORKSPACE, { ...label, name: 'Later, from the cloud', updatedAt: 50 });
		await idb.saveLabel(TEST_WORKSPACE, { ...label, name: 'Earlier, from here', updatedAt: 20 }, [
			'label:renamed'
		]);

		expect((await idb.getAllLabels(TEST_WORKSPACE)).map(({ name }) => name)).toEqual([
			'Later, from the cloud'
		]);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toContain('label:renamed');
	});
});
