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
import { syncStore } from './sync.svelte';
import { syncSnapshot } from '#lib/syncRecords.js';
import type { Note } from '#lib/types.js';
import { TEST_WORKSPACE } from '../../tests/workspace';

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
		syncStore.account = createSyncIdentity();
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
		const sync = vi
			.spyOn(syncStore, 'sync')
			.mockImplementation(async (local, _indicate, pullOnly, apply) => {
				if (pullOnly) {
					await apply!(remote, TEST_WORKSPACE, { readEnvelopes: remote.notes.length });
					return { success: true, snapshot: remote };
				}
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
		expect(sync).toHaveBeenCalledTimes(2);
	});

	it('leaves local data unchanged when recovery authentication fails', async () => {
		syncStore.account = createSyncIdentity();
		const local = remoteNote('unchanged');
		notesStore.notes = [local];
		await putNote(TEST_WORKSPACE, local);
		vi.spyOn(syncStore, 'reauthenticateForRecovery').mockRejectedValue(
			new Error('Server unavailable')
		);
		const sync = vi.spyOn(syncStore, 'sync');
		expect(await notesStore.forcePushWorkspace()).toBe(false);
		expect(sync).not.toHaveBeenCalled();
		expect((await getAllNotesMetadata(TEST_WORKSPACE))[0].updatedAt).toBe(1);
		expect(notesStore.notes[0].title).toBe(local.title);
	});

	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllTimers();
		vi.useRealTimers();
		localStorage.clear();
		notesStore.notes = [];
		notesStore.labels = [];
		notesStore.deletedNoteIds = {};
		notesStore.deletedLabelIds = {};
		notesStore.lastPersistError = null;
		syncStore.account = null;
		vi.restoreAllMocks();
	});

	afterEach(() => {
		syncStore.account = null;
		notesStore.notes = [];
		notesStore.labels = [];
	});

	it('persists pulled notes and boards to IndexedDB before committing the cursor', async () => {
		const account = createSyncIdentity();
		syncStore.account = account;
		const keys = syncControlKeys(account.accountId);
		const pulled = remoteNote();

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
		const boards = await loadBoardsFromDevice<unknown>(TEST_WORKSPACE, null);
		expect(Array.isArray(boards) && boards.length > 0).toBe(true);
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
		syncStore.account = account;
		let depth = 0;
		let maxDepth = 0;
		const locks = {
			request: async (_name: string, callback: () => Promise<boolean>) => {
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
		vi.spyOn(syncTombstones, 'writeTombstones').mockRejectedValueOnce(
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
		await db.put('note-images', { mime: 'image/png', bytes: Uint8Array.from([65]) }, 'lost::pic');
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
		notesStore.loaded = false;

		await notesStore.init();

		const stored = (await getAllNotesMetadata(TEST_WORKSPACE)).find((item) => item.id === 'lost');
		expect(stored).toBeDefined();
		const hydrated = await hydrateNoteAttachments(TEST_WORKSPACE, stored!);
		expect(hydrated.images?.[0]?.dataUrl?.startsWith('data:image/png')).toBe(true);
	});

	it('restores photo bytes from the relay after IndexedDB is wiped', async () => {
		const account = createSyncIdentity();
		syncStore.account = account;
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
		syncStore.account = account;
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
		syncStore.account = account;
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
		syncStore.account = account;
		notesStore.notes = [];
		relayWith(account, [
			{ slot: 'c'.repeat(64), payload: { kind: 'note-tombstone', id: 'gone', deletedAt: 5 } }
		]);

		expect(await notesStore.replaceWithCloudManual()).toBe(true);
		expect(syncStore.lastError).toBeNull();
		expect(notesStore.notes).toEqual([]);
	});

	it('replace-with-cloud keeps local notes when nothing the account holds could be read', async () => {
		const account = createSyncIdentity();
		syncStore.account = account;
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
		syncStore.account = account;
		const local = remoteNote('local-only');
		notesStore.notes = [local];
		let lockRequests = 0;
		let tail: Promise<unknown> = Promise.resolve();
		const locks = {
			request: async (_name: string, callback: () => Promise<boolean>) => {
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
		syncStore.account = account;
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
		syncStore.account = account;
		let depth = 0;
		let maxDepth = 0;
		let active = 0;
		let overlaps = 0;
		const events: string[] = [];
		let tail: Promise<unknown> = Promise.resolve();
		const locks = {
			request: async (_name: string, callback: () => Promise<boolean>) => {
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
			const auto = notesStore.flushSync(true);
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
		notesStore.notes = [];
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
});
