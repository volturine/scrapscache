import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/imageThumb.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/imageThumb.js')>();
	return { ...actual, makeImageThumbDataUrl: vi.fn(async () => null) };
});

import { createSyncIdentity, encryptSyncPayload } from '#lib/syncPairing.js';
import { syncControlKeys } from '#lib/syncEngine.js';
import {
	clearAllLabels,
	clearAllNotes,
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
import { SYNC_LOCK, syncScheduler } from './syncScheduler';
import { syncStore } from './sync.svelte';
import { syncSnapshot } from '#lib/syncRecords.js';
import type { Note } from '#lib/types.js';
import { linkTestWorkspace, unlinkTestWorkspace } from '../../tests/syncing';
import { TEST_WORKSPACE } from '../../tests/workspace';
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
	it('force push persists local winners before upload and never adopts remote-only notes', async () => {
		linkTestWorkspace();
		const local = { ...remoteNote('shared'), title: 'This device wins' };
		notesStore.notes = [local];
		await putNote(TEST_WORKSPACE, local);
		vi.spyOn(syncStore, 'reauthenticateForRecovery').mockResolvedValue();
		const clearControl = vi.spyOn(syncStore, 'clearAccountControlPlane');
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
		const pull = vi.spyOn(syncStore, 'pullOpen').mockImplementation(async (_local, apply) => {
			await apply(remote, TEST_WORKSPACE, {
				readEnvelopes: remote.notes.length,
				relayHolds: () => true,
				relayHas: () => undefined,
				owes: async () => undefined
			});
			return { success: true, snapshot: remote };
		});
		// The upload sends what the database holds by then.
		const sync = vi
			.spyOn(syncStore, 'syncWorkspace')
			.mockImplementation(async (_profile, local) => {
				const { notes, tombstones } = local;
				expect(notes.map((note) => note.title)).toEqual(['This device wins']);
				expect(notes[0].fieldTimes!.title).toBeGreaterThan(6000);
				expect(tombstones['cloud-only']).toBeGreaterThan(6000);
				expect((await getAllNotesMetadata(TEST_WORKSPACE))[0].title).toBe('This device wins');
				// The pull's cursor and ids are kept, and every record is queued, so the
				// upload sends what differs from the cloud without downloading it again.
				expect(clearControl).toHaveBeenCalledTimes(1);
				expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(
					expect.arrayContaining(['note:shared', 'note-tombstone:cloud-only'])
				);
				return { success: true, snapshot: local };
			});
		expect(await notesStore.forcePushWorkspace()).toBe(true);
		expect(pull).toHaveBeenCalledOnce();
		expect(sync).toHaveBeenCalledOnce();
	});

	it('leaves local data unchanged when recovery authentication fails', async () => {
		linkTestWorkspace();
		const local = remoteNote('unchanged');
		notesStore.notes = [local];
		await putNote(TEST_WORKSPACE, local);
		vi.spyOn(syncStore, 'reauthenticateForRecovery').mockRejectedValue(
			new Error('Server unavailable')
		);
		const pull = vi.spyOn(syncStore, 'pullOpen');
		expect(await notesStore.forcePushWorkspace()).toBe(false);
		expect(pull).not.toHaveBeenCalled();
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
		await clearAllNotes(TEST_WORKSPACE);
		await clearAllLabels(TEST_WORKSPACE);
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

	it('replace-with-cloud pulls the account from the start instead of wiping at a caught-up cursor', async () => {
		const account = createSyncIdentity();
		linkTestWorkspace(account.syncKey);
		const local = remoteNote('local-only');
		local.title = 'should be replaced';
		await putNote(TEST_WORKSPACE, local);
		notesStore.notes = [local];
		const keys = syncControlKeys(account.accountId);
		await setSyncState(TEST_WORKSPACE, keys.cursor, 9);
		await setSyncState(TEST_WORKSPACE, keys.baseline, { 'note:local-only': 'fp' });
		const cloud = remoteNote('cloud-1');
		cloud.title = 'from account';

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
						cursor: request.cursor,
						envelopes: [],
						conflicts: [],
						hasMore: false,
						reset: false,
						writesAccepted: true,
						usage: {
							ciphertextBytes: 20,
							storageBytes: 532,
							envelopeCount: 1,
							maxBytes: 1000
						}
					}
				};
			}
			return {
				success: true,
				data: {
					cursor: 1,
					envelopes: [
						{
							seq: 1,
							id: 'cloud-id',
							slot: 'a'.repeat(64),
							ciphertext: encryptSyncPayload(
								account.syncKey,
								{
									kind: 'note',
									value: cloud
								},
								'a'.repeat(64)
							)
						}
					],
					conflicts: [],
					hasMore: false,
					reset: false,
					writesAccepted: true,
					usage: {
						ciphertextBytes: 20,
						storageBytes: 532,
						envelopeCount: 1,
						maxBytes: 1000
					}
				}
			};
		});

		expect(await notesStore.replaceWithCloudManual()).toBe(true);
		expect(notesStore.notes.map((item) => item.id)).toEqual(['cloud-1']);
		expect((await getAllNotesMetadata(TEST_WORKSPACE)).map(({ id }) => id)).toEqual(['cloud-1']);
	});

	/** A relay holding exactly these records, answering a pull from the start in one page. */
	function relayWith(
		account: ReturnType<typeof createSyncIdentity>,
		records: { slot: string; payload: unknown; syncKey?: string }[]
	) {
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
			return {
				success: true,
				data: {
					cursor: records.length,
					envelopes:
						request.cursor > 0
							? []
							: records.map((record, index) => ({
									seq: index + 1,
									id: `id-${index}`,
									slot: record.slot,
									ciphertext: encryptSyncPayload(
										record.syncKey ?? account.syncKey,
										record.payload,
										record.slot
									)
								})),
					conflicts: [],
					hasMore: false,
					reset: false,
					writesAccepted: true,
					usage: {
						ciphertextBytes: 20 * records.length,
						storageBytes: 532 * records.length,
						envelopeCount: records.length,
						maxBytes: 1000_000
					}
				}
			};
		});
	}

	it('replace-with-cloud accepts a workspace that has no notes yet', async () => {
		// Every synced workspace uploads its name, so a new one is never without envelopes.
		const account = createSyncIdentity();
		linkTestWorkspace(account.syncKey);
		const local = remoteNote('local-only');
		await putNote(TEST_WORKSPACE, local);
		notesStore.notes = [local];
		relayWith(account, [
			{ slot: 'b'.repeat(64), payload: { kind: 'profile-meta', value: { name: 'Sunny Marten' } } }
		]);

		expect(await notesStore.replaceWithCloudManual()).toBe(true);
		expect(syncStore.lastError).toBeNull();
		expect(notesStore.notes).toEqual([]);
	});

	it('replace-with-cloud accepts a workspace whose notes were all deleted', async () => {
		const account = createSyncIdentity();
		linkTestWorkspace(account.syncKey);
		notesStore.notes = [];
		notesStore.loaded = true;
		relayWith(account, [
			{ slot: 'c'.repeat(64), payload: { kind: 'note-tombstone', id: 'gone', deletedAt: 5 } }
		]);

		expect(await notesStore.replaceWithCloudManual()).toBe(true);
		expect(syncStore.lastError).toBeNull();
		expect(notesStore.notes).toEqual([]);
	});

	it('replace-with-cloud keeps local notes when nothing the account holds could be read', async () => {
		const account = createSyncIdentity();
		linkTestWorkspace(account.syncKey);
		const local = remoteNote('local-only');
		await putNote(TEST_WORKSPACE, local);
		notesStore.notes = [local];
		const stranger = createSyncIdentity();
		relayWith(account, [
			{
				slot: 'd'.repeat(64),
				payload: { kind: 'note', value: remoteNote('foreign') },
				syncKey: stranger.syncKey
			}
		]);

		expect(await notesStore.replaceWithCloudManual()).toBe(false);
		expect(notesStore.notes.map(({ id }) => id)).toEqual(['local-only']);
		expect((await getAllNotesMetadata(TEST_WORKSPACE)).map(({ id }) => id)).toEqual(['local-only']);
	});

	it('serializes replacement with normal sync before local notes can upload', async () => {
		const account = createSyncIdentity();
		linkTestWorkspace(account.syncKey);
		const local = remoteNote('local-only');
		notesStore.notes = [local];
		let lockRequests = 0;
		let tail: Promise<unknown> = Promise.resolve();
		const locks = {
			request: async (name: string, ...rest: unknown[]) => {
				const callback = rest.at(-1) as () => Promise<boolean>;
				// Only the sync lock is under test; the others are theirs to take.
				if (name !== `${SYNC_LOCK}:${TEST_WORKSPACE}`) return callback();
				lockRequests += 1;
				const run = tail.then(callback);
				tail = run.catch(() => undefined);
				return run;
			}
		};
		Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
		vi.spyOn(syncStore, 'clearAccountControlPlane').mockImplementation(async () => undefined);
		vi.spyOn(
			syncStore as unknown as {
				sendSyncRequest(
					path: string,
					payload: string
				): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
			},
			'sendSyncRequest'
		).mockResolvedValue({
			success: true,
			data: {
				cursor: 1,
				envelopes: [],
				conflicts: [],
				hasMore: false,
				reset: false,
				writesAccepted: true,
				usage: {
					ciphertextBytes: 0,
					storageBytes: 0,
					envelopeCount: 0,
					maxBytes: 1000
				}
			}
		});

		try {
			const replacement = notesStore.replaceWithCloudManual();
			const normalSync = notesStore.syncWithCloudManual();
			const [replaced, synced] = await Promise.all([replacement, normalSync]);
			expect(replaced).toBe(true);
			expect(synced).toBe(true);
		} finally {
			Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
		}

		expect(lockRequests).toBe(2);
		expect(notesStore.notes).toEqual([]);
	});

	it('pairing merge keeps both notes when this device and the account share an id', async () => {
		const account = createSyncIdentity();
		linkTestWorkspace(account.syncKey);
		const local = remoteNote('shared');
		local.title = 'mine';
		local.updatedAt = 20;
		await putNote(TEST_WORKSPACE, local);
		notesStore.notes = [local];
		const cloud = remoteNote('shared');
		cloud.title = 'theirs';
		cloud.updatedAt = 10;

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
						cursor: request.cursor,
						envelopes: [],
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
					envelopes: [
						{
							seq: 1,
							id: 'cloud-id',
							slot: 'b'.repeat(64),
							ciphertext: encryptSyncPayload(
								account.syncKey,
								{
									kind: 'note',
									value: cloud
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
		});

		expect(await notesStore.mergeWithCloudManual()).toBe(true);
		const titles = notesStore.notes.map((item) => item.title).sort();
		expect(titles).toEqual(['mine', 'theirs']);
		const ids = notesStore.notes.map((item) => item.id);
		expect(ids).toContain('shared');
		expect(ids.some((id) => id !== 'shared')).toBe(true);
		expect(notesStore.notes.find((item) => item.id === 'shared')?.title).toBe('theirs');
		expect(notesStore.notes.find((item) => item.id !== 'shared')?.title).toBe('mine');
	});

	it('runs the pairing merge through the same web lock as automatic sync without overlap or re-entry', async () => {
		const account = createSyncIdentity();
		linkTestWorkspace(account.syncKey);
		let depth = 0;
		let maxDepth = 0;
		let active = 0;
		let overlaps = 0;
		const events: string[] = [];
		let tail: Promise<unknown> = Promise.resolve();
		const locks = {
			request: async (name: string, ...rest: unknown[]) => {
				const callback = rest.at(-1) as () => Promise<boolean>;
				// Only the sync lock is under test; the others are theirs to take.
				if (name !== `${SYNC_LOCK}:${TEST_WORKSPACE}`) return callback();
				const run = tail.then(async () => {
					depth += 1;
					active += 1;
					maxDepth = Math.max(maxDepth, depth);
					if (active > 1) overlaps += 1;
					events.push('enter');
					try {
						return await callback();
					} finally {
						events.push('exit');
						active -= 1;
						depth -= 1;
					}
				});
				tail = run.catch(() => undefined);
				return run;
			}
		};
		Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
		let firstAutoRound: (() => void) | null = null;
		const started = new Promise<void>((resolve) => {
			firstAutoRound = resolve;
		});
		vi.spyOn(
			syncStore as unknown as {
				sendSyncRequest(
					path: string,
					payload: string
				): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
			},
			'sendSyncRequest'
		).mockImplementation(async () => {
			firstAutoRound?.();
			firstAutoRound = null;
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
		vi.spyOn(syncStore, 'clearAccountControlPlane').mockImplementation(async () => undefined);

		try {
			const auto = notesStore.flushSync();
			await started;

			const merged = notesStore.mergeWithCloudManual();
			expect(await auto).toBe(true);
			expect(await merged).toBe(true);
		} finally {
			Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
		}

		expect(overlaps).toBe(0);
		expect(maxDepth).toBe(1);
		expect(events.filter((event) => event === 'enter').length).toBeGreaterThanOrEqual(3);
	});
});

describe('applying a pulled snapshot during local edits', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		unlinkTestWorkspace();
		notesStore.notes = [];
		notesStore.labels = [];
		notesStore.loaded = true;
	});

	it('does not roll the device copy back behind an edit made while the flight awaited', async () => {
		await clearAllNotes(TEST_WORKSPACE);
		const local = remoteNote('racing');
		notesStore.notes = [local];
		await putNote(TEST_WORKSPACE, local);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const write = syncTombstones.writeTombstones;
		vi.spyOn(syncTombstones, 'writeTombstones').mockImplementation(async (...args) => {
			await gate;
			return write(...args);
		});

		const pulled = {
			...remoteNote('racing'),
			title: 'renamed elsewhere',
			fieldTimes: { title: 5 }
		};
		const applying = (
			notesStore as unknown as {
				applyPulledSnapshot(snapshot: unknown, pid: string): Promise<unknown>;
			}
		).applyPulledSnapshot(syncSnapshot({ notes: [pulled] }), TEST_WORKSPACE);
		notesStore.updateNote('racing', { pinned: true });
		release();
		await applying;
		await idb.waitForDeviceWrites();

		const [stored] = (await getAllNotesMetadata(TEST_WORKSPACE)).filter(
			(note) => note.id === 'racing'
		);
		expect(stored).toMatchObject({ title: 'renamed elsewhere', pinned: true });
	});
	// After a sync, what the window holds that the database does not is saved again.
	// Those saves are asked for in one step: an edit made while they are being
	// written takes its place after them, so it is never the older one that lands last.
	it('does not roll back an edit made while what changed during a sync is being saved', async () => {
		linkTestWorkspace();
		notesStore.loaded = true;
		await clearAllNotes(TEST_WORKSPACE);
		const first = { ...remoteNote('first'), updatedAt: 10 };
		const second = { ...remoteNote('second'), updatedAt: 9 };
		await putNote(TEST_WORKSPACE, first);
		await putNote(TEST_WORKSPACE, second);
		// Both were edited here since the sync read them.
		notesStore.notes = [first, second].map((item) => ({
			...item,
			title: `${item.id}, edited here`,
			fieldTimes: { ...item.fieldTimes, title: 20 }
		}));
		const put = idb.putNote;
		let editedAgain = false;
		vi.spyOn(idb, 'putNote').mockImplementation((...args) => {
			if (!editedAgain) {
				editedAgain = true;
				// While the first of them is being written, the other is edited once more.
				queueMicrotask(() => notesStore.updateNote('second', { pinned: true }));
			}
			return put(...args);
		});

		await (
			notesStore as unknown as {
				showSynced(pid: string, saved: unknown, decisions: Map<string, unknown>): Promise<void>;
			}
		).showSynced(TEST_WORKSPACE, syncSnapshot({ notes: [first, second] }), new Map());
		await idb.waitForDeviceWrites(TEST_WORKSPACE);

		const stored = await getAllNotesMetadata(TEST_WORKSPACE);
		expect(stored.find((item) => item.id === 'first')?.title).toBe('first, edited here');
		expect(stored.find((item) => item.id === 'second')).toMatchObject({
			title: 'second, edited here',
			pinned: true
		});
		// What was saved again is queued to upload.
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(
			expect.arrayContaining(['note:first', 'note:second'])
		);
	});

	it('saves a label again, queued to upload, when its own save never reached the database', async () => {
		linkTestWorkspace();
		notesStore.loaded = true;
		const label = { id: 'unsaved-label', name: 'Only in this window', createdAt: 1, updatedAt: 5 };
		notesStore.labels = [label];

		await (
			notesStore as unknown as {
				showSynced(pid: string, saved: unknown, decisions: Map<string, unknown>): Promise<void>;
			}
		).showSynced(TEST_WORKSPACE, syncSnapshot(), new Map());

		expect((await idb.getAllLabels(TEST_WORKSPACE)).map(({ name }) => name)).toEqual([
			'Only in this window'
		]);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toContain('label:unsaved-label');
	});
});
