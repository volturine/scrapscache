import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A resident thumbnail, as a real device makes one: memory then holds the
// thumbnail and releases the full bytes, which is the state a phone syncs from.
vi.mock('#lib/imageThumb.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/imageThumb.js')>();
	return {
		...actual,
		makeImageThumbDataUrl: vi.fn(async () => 'data:image/png;base64,dGh1bWI=')
	};
});

import { testDb, cleanupTestDbs } from '#lib/server/testDb.js';
import { SyncStore as RelayStore } from '#lib/server/syncStore.js';
import {
	createSyncIdentity,
	decryptSyncPayload,
	encryptSyncPayload,
	randomOpaqueId,
	type SyncIdentity
} from '#lib/syncPairing.js';
import { openDB } from 'idb';
import {
	attachmentWritesLock,
	deleteSyncState,
	getAllNotesMetadata,
	getStoredAttachmentVersions,
	hydrateNoteAttachments,
	putNote,
	resolveDbName
} from '#lib/db/idb.js';
import * as idb from '#lib/db/idb.js';
import { hydrateHistoryNote, loadNoteHistory } from '#lib/historyClient.js';
import { SyncStore, syncStore } from './sync.svelte';
import { notesStore } from './notes.svelte';
import { syncScheduler } from './syncScheduler';
import {
	splitNoteForSync,
	syncSnapshot,
	type SyncNote,
	type SyncRecordPayload,
	type SyncSnapshot
} from '#lib/syncRecords.js';
import { syncControlKeys } from '#lib/syncEngine.js';
import { photoMarker } from '#lib/photoMarker.js';
import type { Note, NoteImage } from '#lib/types.js';
import { sha256 } from '#lib/syncHash.js';
import { seedTestKeyring, TEST_WORKSPACE } from '../../tests/workspace';
import { syncOpen } from '../../tests/openSync';
import { linkTestWorkspace, unlinkTestWorkspace } from '../../tests/syncing';
import * as settling from '#lib/attachmentSettling.js';

const OTHER_DEVICE = 'device-a';

function bytes(text: string): string {
	return `data:image/png;base64,${btoa(text)}`;
}

/** A photo as the app makes one: its hash is the hash of its bytes. */
async function photo(
	id: string,
	dataUrl: string,
	extra: Partial<NoteImage> = {}
): Promise<NoteImage> {
	return {
		id,
		mime: 'image/png',
		dataUrl,
		createdAt: 1,
		contentHash: await sha256(dataUrl),
		...extra
	};
}

function note(id: string, images: NoteImage[], at = 1): Note {
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
		updatedAt: at,
		reminder: null,
		labels: [],
		images,
		fieldTimes: {
			title: 1,
			body: 1,
			color: 1,
			pinned: 1,
			archived: 1,
			trashed: 1,
			reminder: 1,
			labels: 1,
			images: at,
			linkPreviews: 1
		}
	};
}

type Send = (
	path: string,
	payload: string
) => Promise<{ success: boolean; data?: unknown; error?: string }>;

/** Route one client's rounds to the relay; `afterUpload` runs once a round's uploads are stored. */
function wire(
	client: SyncStore,
	relay: RelayStore,
	options: { limit?: number; afterUpload?: () => Promise<void>; cursors?: number[] } = {}
): void {
	vi.spyOn(client as unknown as { sendSyncRequest: Send }, 'sendSyncRequest').mockImplementation(
		async (_path, payload) => {
			const body = JSON.parse(payload) as {
				cursor: number;
				envelopes: unknown[];
				deleteSlots: Array<{ id: string; slot: string }>;
				limit?: number;
			};
			options.cursors?.push(body.cursor);
			const data = await relay.sync(
				client.account!.accountId,
				body.cursor,
				body.envelopes as never,
				body.deleteSlots,
				options.limit ?? body.limit ?? 12
			);
			if (data.writesAccepted && body.envelopes.length > 0) await options.afterUpload?.();
			return { success: true, data };
		}
	);
}

/** The other device: it holds every photo in full and uploads as the app does. */
async function otherDevice(
	relay: RelayStore,
	identity: SyncIdentity,
	afterUpload?: () => Promise<void>
) {
	const client = new SyncStore();
	await client.ensureProfilesLoaded();
	client.account = identity;
	client.activeId = OTHER_DEVICE;
	wire(client, relay, { afterUpload });
	const device = {
		notes: [] as Note[],
		async save(next: Note) {
			device.notes = [...device.notes.filter((item) => item.id !== next.id), next];
			await putNote(OTHER_DEVICE, next, [
				`note:${next.id}`,
				...(next.images ?? []).map((image) => `attachment:${image.id}`)
			]);
		},
		async sync() {
			const result = await syncOpen(
				client,
				syncSnapshot({ notes: device.notes }),
				async (snapshot: SyncSnapshot) => {
					for (const item of snapshot.notes) await putNote(OTHER_DEVICE, item);
					device.notes = snapshot.notes;
					return snapshot;
				}
			);
			expect(result.success, result.error).toBe(true);
		}
	};
	return device;
}

/** This device is the app's own stores: the phone in these cases. */
async function phoneSync(): Promise<void> {
	expect(await notesStore.syncWithCloudManual()).toBe(true);
}

/** What the phone holds on disk for a note, attachments in full; null when it has no such note. */
async function phoneStored(id: string): Promise<Note | null> {
	const stored = (await getAllNotesMetadata(TEST_WORKSPACE)).find((item) => item.id === id);
	return stored ? hydrateNoteAttachments(TEST_WORKSPACE, stored) : null;
}

/** Reach into the phone's storage, as damage or an older app version would have left it. */
async function phoneBytesStore(
	change: (store: {
		put(value: { mime: string; bytes: Uint8Array; hash?: string }, key: string): Promise<unknown>;
		delete(key: string): Promise<void>;
	}) => Promise<unknown>
): Promise<void> {
	await getAllNotesMetadata(TEST_WORKSPACE);
	const db = await openDB(resolveDbName(TEST_WORKSPACE));
	try {
		await change({
			put: (value, key) => db.put('note-images', value, key),
			delete: (key) => db.delete('note-images', key)
		});
	} finally {
		db.close();
	}
}

/** Web Locks as browsers grant them: any number share a lock, one holds it alone, in turn. */
function sharedLocks(): LockManager {
	type Request = { mode: LockMode; start: () => Promise<void> };
	const queues = new Map<string, { holders: LockMode[]; waiting: Request[] }>();
	const grant = (name: string) => {
		const queue = queues.get(name)!;
		while (queue.waiting.length) {
			const next = queue.waiting[0];
			const free =
				queue.holders.length === 0 ||
				(next.mode === 'shared' && queue.holders.every((mode) => mode === 'shared'));
			if (!free) return;
			queue.waiting.shift();
			queue.holders.push(next.mode);
			void next.start().finally(() => {
				queue.holders.splice(queue.holders.indexOf(next.mode), 1);
				grant(name);
			});
		}
	};
	return {
		request(name: string, ...rest: unknown[]) {
			const run = rest.at(-1) as () => unknown;
			const mode = (rest.length > 1 ? (rest[0] as LockOptions).mode : undefined) ?? 'exclusive';
			if (!queues.has(name)) queues.set(name, { holders: [], waiting: [] });
			return new Promise((resolve, reject) => {
				queues.get(name)!.waiting.push({
					mode,
					start: () =>
						Promise.resolve()
							.then(run)
							.then(resolve as (value: unknown) => void, reject)
				});
				grant(name);
			});
		}
	} as LockManager;
}

function photoBytes(stored: Note | null): Record<string, string> {
	return Object.fromEntries((stored?.images ?? []).map((image) => [image.id, image.dataUrl]));
}

describe('attachments across devices', () => {
	let relay: RelayStore;
	let identity: SyncIdentity;
	/** Attachments the phone asked the relay for by name. */
	let askedByName: number;
	/** The cursor of every request the phone sent. */
	let phoneCursors: number[];

	/** Every record the relay holds, decrypted. */
	async function relayRecords(): Promise<SyncRecordPayload[]> {
		const records: SyncRecordPayload[] = [];
		let cursor = 0;
		for (;;) {
			const page = await relay.sync(identity.accountId, cursor, [], [], 50);
			for (const envelope of page.envelopes)
				records.push(
					decryptSyncPayload(
						identity.syncKey,
						envelope.ciphertext,
						envelope.slot
					) as SyncRecordPayload
				);
			cursor = page.cursor;
			if (!page.hasMore) return records;
		}
	}

	/** The rule every request has to keep: the relay lists no attachment version it lacks. */
	async function expectRelayHoldsWhatItLists(): Promise<void> {
		const records = await relayRecords();
		const held = new Map(
			records.flatMap((record) =>
				record.kind === 'attachment' ? [[record.value.id, record.value.hash] as const] : []
			)
		);
		for (const record of records) {
			if (record.kind !== 'note') continue;
			for (const image of record.value.images ?? [])
				expect(held.get(image.id), `${record.value.id} lists ${image.id}`).toBe(image.hash);
		}
	}

	/** The relay's copy of a note, as a device that has synced sees it. */
	async function onTheRelay(id: string) {
		const records = await relayRecords();
		const found = records.find((record) => record.kind === 'note' && record.value.id === id);
		const noteRecord = found?.kind === 'note' ? found.value : undefined;
		return {
			pinned: noteRecord?.pinned,
			lists: (noteRecord?.images ?? []).map((image) => image.id),
			holds: Object.fromEntries(
				records.flatMap((record) =>
					record.kind === 'attachment' ? [[record.value.id, record.value.dataUrl]] : []
				)
			)
		};
	}

	/** Write note records to the relay as an app version from before this rule did. */
	async function olderVersionUploads(notes: SyncNote[]): Promise<void> {
		for (const value of notes) {
			const payload: SyncRecordPayload = { kind: 'note', value };
			const key = `note:${value.id}`;
			const slot = await sha256(`${identity.syncKey}\u0000${key}`);
			const caughtUp = (await relay.sync(identity.accountId, 0, [], [], 50)).cursor;
			const written = await relay.sync(
				identity.accountId,
				caughtUp,
				[
					{
						id: randomOpaqueId(),
						slot,
						expectedId: null,
						ciphertext: encryptSyncPayload(identity.syncKey, payload, slot)
					}
				],
				[],
				50
			);
			expect(written.writesAccepted).toBe(true);
		}
	}

	beforeEach(async () => {
		localStorage.clear();
		seedTestKeyring();
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		relay = new RelayStore(testDb());
		identity = createSyncIdentity();
		await relay.createAccount(identity.accountId, 'credential');
		linkTestWorkspace(identity.syncKey);
		phoneCursors = [];
		wire(syncStore, relay, { cursors: phoneCursors });
		askedByName = 0;
		// The history route, answered by the same relay.
		vi.spyOn(syncStore, 'authorizedFetch').mockImplementation(async (input) => {
			const url = new URL(String(input), 'https://relay.test');
			const slot = url.searchParams.get('slot');
			const at = url.searchParams.get('at');
			if (url.pathname !== '/api/sync/history' || !slot)
				return Response.json({ error: 'Not found' }, { status: 404 });
			if (at === null) return Response.json(await relay.listHistory(identity.accountId, slot));
			askedByName += 1;
			const envelope = await relay.getEnvelopeAt(identity.accountId, slot, Number(at));
			return envelope
				? Response.json(envelope)
				: Response.json({ error: 'Envelope not found' }, { status: 404 });
		});
		notesStore.notes = [];
		notesStore.loaded = true;
		notesStore.labels = [];
		notesStore.deletedNoteIds = {};
		notesStore.lastPersistError = null;
	});

	afterEach(async () => {
		await syncScheduler.reset();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		unlinkTestWorkspace();
		notesStore.notes = [];
		notesStore.loaded = true;
		cleanupTestDbs();
	});

	describe('uploading', () => {
		it('sends a photo in the same request as the note that lists it', async () => {
			const shot = await photo('shot', bytes('the photo'));
			// The phone syncs after every request of the other device that stored something.
			const seenByPhone: Array<Record<string, string> | 'no note yet'> = [];
			const other = await otherDevice(relay, identity, async () => {
				await expectRelayHoldsWhatItLists();
				await phoneSync();
				const stored = await phoneStored('trip');
				seenByPhone.push(stored ? photoBytes(stored) : 'no note yet');
			});
			await other.save(note('trip', [shot]));
			await other.sync();

			// One request, and the phone never held the note without its photo.
			expect(seenByPhone).toEqual([{ shot: shot.dataUrl }]);
			expect(notesStore.notes[0].images?.[0].thumbUrl).toBeTruthy();
			expect(askedByName).toBe(0);
			expect(syncStore.lastError).toBeNull();
			expect(notesStore.lastPersistError).toBeNull();
		});

		it("lists a note's photos on the relay only as their bytes arrive", async () => {
			const shots = await Promise.all(
				['a', 'b', 'c', 'd', 'e'].map((id) => photo(id, bytes(`photo ${id}`)))
			);
			const seenByPhone: number[] = [];
			const other = await otherDevice(relay, identity, async () => {
				await expectRelayHoldsWhatItLists();
				await phoneSync();
				const held = photoBytes(await phoneStored('album'));
				// Whatever the phone lists, it holds.
				expect(Object.values(held).every((dataUrl) => dataUrl.length > 0)).toBe(true);
				seenByPhone.push(Object.keys(held).length);
			});
			await other.save(note('album', shots));
			await other.sync();
			await phoneSync();

			expect(seenByPhone).toEqual([2, 4, 5]);
			expect(photoBytes(await phoneStored('album'))).toEqual(
				Object.fromEntries(shots.map((shot) => [shot.id, shot.dataUrl]))
			);
			// The steps are one version of the note, not three.
			expect(await loadNoteHistory(identity, 'album')).toHaveLength(1);
			expect(askedByName).toBe(0);
		});

		it('replaces an edited photo and its note together', async () => {
			const other = await otherDevice(relay, identity);
			await other.save(note('trip', [await photo('shot', bytes('first crop'))]));
			await other.sync();
			await phoneSync();
			expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: bytes('first crop') });

			// The edit keeps the photo's id.
			const edited = await otherDevice(relay, identity, async () => {
				await expectRelayHoldsWhatItLists();
				await phoneSync();
			});
			edited.notes = other.notes;
			await edited.save(
				note('trip', [await photo('shot', bytes('second crop'), { editedAt: 20 })], 20)
			);
			await edited.sync();
			expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: bytes('second crop') });

			// A later edit on the phone uploads the note again, not the earlier crop.
			notesStore.togglePin('trip');
			await notesStore.flushNote('trip');
			await phoneSync();
			expect(await onTheRelay('trip')).toEqual({
				pinned: true,
				lists: ['shot'],
				holds: { shot: bytes('second crop') }
			});
		});

		it('keeps both devices whole when one edits a note the other is still uploading', async () => {
			const shots = await Promise.all(['a', 'b', 'c'].map((id) => photo(id, bytes(`photo ${id}`))));
			let edited = false;
			const other = await otherDevice(relay, identity, async () => {
				await phoneSync();
				if (edited) return;
				edited = true;
				notesStore.togglePin('album');
				await notesStore.flushNote('album');
				await phoneSync();
				await expectRelayHoldsWhatItLists();
			});
			await other.save(note('album', shots));
			await other.sync();
			await phoneSync();
			await other.sync();

			const all = Object.fromEntries(shots.map((shot) => [shot.id, shot.dataUrl]));
			const stored = await phoneStored('album');
			expect(photoBytes(stored)).toEqual(all);
			expect(stored?.pinned).toBe(true);
			expect(await onTheRelay('album')).toEqual({
				pinned: true,
				lists: ['a', 'b', 'c'],
				holds: all
			});
			expect(photoBytes(other.notes.find((item) => item.id === 'album') ?? null)).toEqual(all);
		});

		// A sync saves what it pulled into the database and the window shows it a
		// moment later. An edit made in between was made on the note as it was before
		// the sync, and is saved whole: it must not undo what the sync just saved.
		it('keeps what a sync pulled when the note is edited before the window shows it', async () => {
			const other = await otherDevice(relay, identity);
			await other.save(note('trip', []));
			await other.sync();
			await phoneSync();
			expect(notesStore.notes.map((item) => item.title)).toEqual(['trip']);
			await other.save({
				...note('trip', [], 9),
				title: 'Renamed on the other device',
				fieldTimes: { ...note('trip', []).fieldTimes, title: 9 }
			});
			await other.sync();
			const mergeLabels = idb.mergeStoredLabels;
			let editedBetween = false;
			vi.spyOn(idb, 'mergeStoredLabels').mockImplementation(async (...args) => {
				// The renamed note is in the database; the window still shows the old one.
				if (!editedBetween && (await phoneStored('trip'))?.title !== 'trip') {
					editedBetween = true;
					expect(notesStore.notes.map((item) => item.title)).toEqual(['trip']);
					notesStore.togglePin('trip');
				}
				return mergeLabels(...args);
			});

			await phoneSync();
			await idb.waitForDeviceWrites(TEST_WORKSPACE);

			expect(editedBetween).toBe(true);
			const shown = notesStore.notes.find((item) => item.id === 'trip');
			expect([shown?.title, shown?.pinned]).toEqual(['Renamed on the other device', true]);
			const stored = await phoneStored('trip');
			expect([stored?.title, stored?.pinned]).toEqual(['Renamed on the other device', true]);

			// The pin is sent with the next sync, and the rename is still on the relay.
			await phoneSync();
			await other.sync();
			const theirs = other.notes.find((item) => item.id === 'trip');
			expect([theirs?.title, theirs?.pinned]).toEqual(['Renamed on the other device', true]);
		});

		// A note deleted for good while a sync waits on the relay stays deleted: the
		// sync must not save its own older copy back, and the delete reaches the relay.
		it('does not bring back a note deleted for good while a sync was under way', async () => {
			const other = await otherDevice(relay, identity);
			await other.save(note('trip', []));
			await other.sync();
			await phoneSync();
			await other.save({
				...note('trip', [], 9),
				title: 'Renamed on the other device',
				fieldTimes: { ...note('trip', []).fieldTimes, title: 9 }
			});
			await other.sync();
			const settle = settling.settleAttachments;
			let deletedMeanwhile = false;
			vi.spyOn(settling, 'settleAttachments').mockImplementation(async (...args) => {
				// The sync has read the workspace and is still asking the relay.
				if (!deletedMeanwhile) {
					deletedMeanwhile = true;
					await notesStore.deleteNoteForever('trip');
				}
				return settle(...args);
			});

			await phoneSync();
			await idb.waitForDeviceWrites(TEST_WORKSPACE);

			expect(deletedMeanwhile).toBe(true);
			expect(await phoneStored('trip')).toBeNull();
			expect(notesStore.notes).toEqual([]);

			await phoneSync();
			await other.sync();
			expect(other.notes.map((item) => item.id)).not.toContain('trip');
			expect((await relayRecords()).map((record) => record.kind)).toContain('note-tombstone');
		});

		// What a sync saves and then shows is the same thing: showing it must not
		// queue anything, or every sync would be followed by another for ever.
		it('queues nothing again once a workspace with photos has settled', async () => {
			const shot = await photo('shot', bytes('the photo'));
			const other = await otherDevice(relay, identity);
			await other.save(note('trip', [shot]));
			await other.sync();
			const mine = notesStore.createNote({ title: 'Written on the phone' });
			await notesStore.flushNote(mine.id);
			await phoneSync();
			await phoneSync();
			await idb.waitForDeviceWrites(TEST_WORKSPACE);

			expect(await idb.getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
			const before = phoneCursors.length;
			await phoneSync();
			await idb.waitForDeviceWrites(TEST_WORKSPACE);

			expect(await idb.getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
			// One request to ask what is new, and nothing to send after it.
			expect(phoneCursors.length - before).toBe(1);
		});

		it('sends a photo taken on the phone to the other device', async () => {
			const shot = await photo('shot', bytes('taken here'));
			const created = notesStore.createNote({ title: 'From the phone' });
			await notesStore.flushNote(created.id, { images: [shot] });
			await phoneSync();
			await expectRelayHoldsWhatItLists();

			const other = await otherDevice(relay, identity);
			await other.sync();

			expect(other.notes.find((item) => item.id === created.id)?.images?.[0].dataUrl).toBe(
				shot.dataUrl
			);
			expect(syncStore.lastError).toBeNull();
		});
	});

	describe('a device that holds less than its notes list', () => {
		it('stores every note and photo when a new device downloads over many pages', async () => {
			const other = await otherDevice(relay, identity);
			const ids = Array.from({ length: 9 }, (_, index) => `note-${index}`);
			for (const id of ids) await other.save(note(id, [await photo(`${id}-shot`, bytes(id))]));
			await other.sync();

			// Three records a page: a note and its photo land on different pages.
			wire(syncStore, relay, { limit: 3 });
			await phoneSync();

			for (const id of ids)
				expect(photoBytes(await phoneStored(id))).toEqual({ [`${id}-shot`]: bytes(id) });
			expect(askedByName).toBe(0);
		});

		it('fetches by name a photo whose bytes it lost', async () => {
			const shot = await photo('shot', bytes('the photo'));
			const other = await otherDevice(relay, identity);
			await other.save(note('trip', [shot]));
			await other.sync();
			await phoneSync();
			// The bytes go, long after the sync that brought them.
			await phoneBytesStore((store) => store.delete('trip::shot'));
			expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: '' });

			await phoneSync();

			expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: shot.dataUrl });
			expect(askedByName).toBe(1);
			// Nothing about the note changed, so nothing is sent.
			await phoneSync();
			expect(askedByName).toBe(1);
		});

		it('replaces bytes that are not the version the note lists, before anything uploads', async () => {
			const other = await otherDevice(relay, identity);
			await other.save(note('trip', [await photo('shot', bytes('first crop'))]));
			await other.sync();
			await other.save(
				note('trip', [await photo('shot', bytes('second crop'), { editedAt: 20 })], 20)
			);
			await other.sync();
			await phoneSync();
			// What an earlier version of the app could leave behind: the note lists the
			// second crop and the bytes under it are the first, with no version on them.
			await phoneBytesStore((store) =>
				store.put(
					{ mime: 'image/png', bytes: new TextEncoder().encode('first crop') },
					'trip::shot'
				)
			);
			// An edit is waiting, so this sync has the note to send.
			notesStore.togglePin('trip');
			await notesStore.flushNote('trip');

			await phoneSync();

			expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: bytes('second crop') });
			expect(await onTheRelay('trip')).toEqual({
				pinned: true,
				lists: ['shot'],
				holds: { shot: bytes('second crop') }
			});
		});

		it('stops the sync when the relay cannot be asked, and sends nothing', async () => {
			const shot = await photo('shot', bytes('the photo'));
			const other = await otherDevice(relay, identity);
			await other.save(note('trip', [shot]));
			await other.sync();
			await phoneSync();
			await phoneBytesStore((store) => store.delete('trip::shot'));
			notesStore.togglePin('trip');
			await notesStore.flushNote('trip');

			vi.mocked(syncStore.authorizedFetch).mockRejectedValueOnce(new Error('offline'));
			expect(await notesStore.syncWithCloudManual()).toBe(false);
			expect((await onTheRelay('trip')).pinned).toBe(false);

			// The next sync asks again and goes through.
			await phoneSync();
			expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: shot.dataUrl });
			expect((await onTheRelay('trip')).pinned).toBe(true);
		});

		// A rewrite of the workspace takes its sync lock from a sync that is still
		// asking, however long the relay would take to answer.
		it('gives up the request for a rewrite, sends nothing, and goes again after it', async () => {
			const shot = await photo('shot', bytes('the photo'));
			const other = await otherDevice(relay, identity);
			await other.save(note('trip', [shot]));
			await other.sync();
			await phoneSync();
			await phoneBytesStore((store) => store.delete('trip::shot'));
			notesStore.togglePin('trip');
			await notesStore.flushNote('trip');

			let unanswered: AbortSignal | null | undefined;
			vi.mocked(syncStore.authorizedFetch).mockImplementationOnce((_input, init) => {
				unanswered = init?.signal;
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
				});
			});
			const flight = notesStore.syncWithCloudManual();
			await vi.waitFor(() => expect(unanswered).toBeTruthy());

			let duringHandover: { pinned?: boolean; bytes: Record<string, string> } | undefined;
			await syncScheduler.rewrite(TEST_WORKSPACE, async () => {
				duringHandover = {
					pinned: (await onTheRelay('trip')).pinned,
					bytes: photoBytes(await phoneStored('trip'))
				};
			});

			// The handover found the workspace as the sync had found it: nothing of the
			// round was sent to the relay or written to the device.
			expect(unanswered?.aborted).toBe(true);
			expect(duringHandover).toEqual({ pinned: false, bytes: { shot: '' } });
			// The same sync then goes through, and reports nothing of the round it gave up.
			expect(await flight).toBe(true);
			expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: shot.dataUrl });
			expect((await onTheRelay('trip')).pinned).toBe(true);
			expect(notesStore.lastPersistError).toBeNull();
			expect(syncStore.lastError).toBeNull();
		});
	});

	describe('an attachment that was never uploaded', () => {
		it('is dropped where it has no bytes, and comes back from a device that holds it', async () => {
			// An older version uploaded the note and never the photo it lists.
			const shot = await photo('shot', bytes('only on one device'));
			const listing = note('trip', [shot]);
			await olderVersionUploads([(await splitNoteForSync(listing)).note]);

			await phoneSync();

			// The phone has no bytes and the relay holds none: it was never there.
			expect(photoBytes(await phoneStored('trip'))).toEqual({});
			expect(await onTheRelay('trip')).toEqual({ pinned: false, lists: [], holds: {} });
			await expectRelayHoldsWhatItLists();

			// The device that does hold it syncs, and it is back everywhere.
			const owner = await otherDevice(relay, identity);
			await owner.save(listing);
			await owner.sync();
			await phoneSync();

			expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: shot.dataUrl });
			expect(await onTheRelay('trip')).toEqual({
				pinned: false,
				lists: ['shot'],
				holds: { shot: shot.dataUrl }
			});
		});

		it('gives way to the version the relay holds when only an edit was lost', async () => {
			const other = await otherDevice(relay, identity);
			const first = await photo('shot', bytes('first crop'));
			await other.save(note('trip', [first]));
			await other.sync();
			await phoneSync();
			// The app was closed before a crop finished saving: the note lists the
			// crop, the bytes of it were never written, and nothing was uploaded.
			const lost = await photo('shot', bytes('second crop'), { editedAt: 20 });
			const listing = note('trip', [{ ...lost, dataUrl: '' }], 20);
			await putNote(TEST_WORKSPACE, listing, ['note:trip']);
			notesStore.notes = [listing];

			await phoneSync();

			const stored = await phoneStored('trip');
			expect(photoBytes(stored)).toEqual({ shot: bytes('first crop') });
			expect(stored?.images?.[0].contentHash).toBe(first.contentHash);
			expect(await onTheRelay('trip')).toEqual({
				pinned: false,
				lists: ['shot'],
				holds: { shot: bytes('first crop') }
			});
		});

		it('leaves no trace in the note when a new photo was lost before it was saved', async () => {
			const ghost = await photo('ghost', bytes('never saved'), { name: 'ghost.png' });
			const listing = {
				...note('trip', [{ ...ghost, dataUrl: '' }]),
				body: `before\n${photoMarker(ghost)}\nafter`
			};
			await putNote(TEST_WORKSPACE, listing, ['note:trip']);
			notesStore.notes = [listing];

			await phoneSync();

			const stored = await phoneStored('trip');
			expect(stored?.images).toEqual([]);
			expect(stored?.body).toBe('before\nafter');
			expect((await onTheRelay('trip')).lists).toEqual([]);
			await expectRelayHoldsWhatItLists();
		});
	});

	it('keeps a photo no relay holds when the device holds another version of it', async () => {
		// A photo that never synced, and a crop of it that was lost before it was saved.
		const first = await photo('shot', bytes('first crop'));
		await putNote(TEST_WORKSPACE, note('trip', [first]));
		const lost = await photo('shot', bytes('second crop'), { editedAt: 20 });
		const listing = note('trip', [{ ...lost, dataUrl: '' }], 20);
		await putNote(TEST_WORKSPACE, listing, ['note:trip']);
		notesStore.notes = [listing];

		await phoneSync();

		// The bytes it holds are the photo: listed again, and uploaded.
		const stored = await phoneStored('trip');
		expect(photoBytes(stored)).toEqual({ shot: bytes('first crop') });
		expect(stored?.images?.[0].contentHash).toBe(first.contentHash);
		expect(await onTheRelay('trip')).toEqual({
			pinned: false,
			lists: ['shot'],
			holds: { shot: bytes('first crop') }
		});
	});

	describe('a workspace that does not sync', () => {
		async function boot(listing: Note): Promise<Note | null> {
			unlinkTestWorkspace();
			await putNote(TEST_WORKSPACE, listing);
			notesStore.notes = [];
			notesStore.loaded = true;
			notesStore.loaded = false;
			await notesStore.init();
			return phoneStored(listing.id);
		}

		it('lists the version it holds when an edit was lost before it was saved', async () => {
			const first = await photo('shot', bytes('first crop'));
			await putNote(TEST_WORKSPACE, note('trip', [first]));
			const lost = await photo('shot', bytes('second crop'), { editedAt: 20 });

			const stored = await boot(note('trip', [{ ...lost, dataUrl: '' }], 20));

			expect(photoBytes(stored)).toEqual({ shot: bytes('first crop') });
			expect(stored?.images?.[0].contentHash).toBe(first.contentHash);
		});

		it('waits for a photo another window is still saving before deciding it is absent', async () => {
			vi.stubGlobal('navigator', { ...navigator, locks: sharedLocks() });
			const shot = await photo('shot', bytes('being saved'));
			const listing = note('trip', [{ ...shot, dataUrl: '' }]);
			// The other window has asked to save the photo: it holds the lock every
			// write of bytes holds until it lands.
			let landed!: () => void;
			const saving = navigator.locks.request(
				attachmentWritesLock(TEST_WORKSPACE),
				{ mode: 'shared' },
				() => new Promise<void>((resolve) => (landed = resolve))
			);

			const booting = boot(listing);
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(notesStore.loaded).toBe(false);

			// Its bytes land, as that window's own write stores them.
			await phoneBytesStore((store) =>
				store.put(
					{
						mime: 'image/png',
						bytes: new TextEncoder().encode('being saved'),
						hash: shot.contentHash
					},
					'trip::shot'
				)
			);
			landed();
			await saving;

			expect(photoBytes(await booting)).toEqual({ shot: shot.dataUrl });
		});

		it('holds the lock before a note listing new bytes can be read by another window', async () => {
			unlinkTestWorkspace();
			const locks = sharedLocks();
			const order: string[] = [];
			vi.stubGlobal('navigator', {
				...navigator,
				locks: {
					request: (name: string, ...rest: unknown[]) => {
						if (name === attachmentWritesLock(TEST_WORKSPACE))
							order.push((rest[0] as LockOptions).mode ?? 'exclusive');
						return (locks.request as (...args: unknown[]) => Promise<unknown>)(name, ...rest);
					}
				}
			});
			const created = notesStore.createNote({ title: 'trip' });
			await notesStore.flushNote(created.id);
			order.length = 0;
			const publish = Storage.prototype.setItem;
			vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
				this: Storage,
				key: string,
				value: string
			) {
				if (key.startsWith('scrapscache-notes-pending')) order.push('journal');
				publish.call(this, key, value);
			});
			const shot = await photo('shot', bytes('being saved'));

			// The app's own write path: the note is journaled, then written.
			notesStore.updateNote(created.id, { images: [shot] });
			expect(order.slice(0, 2)).toEqual(['shared', 'journal']);

			// A window asking what is held now waits for those bytes, and finds them.
			const held = await getStoredAttachmentVersions(TEST_WORKSPACE);
			expect(held.get(`${created.id}::shot`)).toBe(shot.contentHash);
		});

		it('keeps the lock through the retry of a write that failed', async () => {
			unlinkTestWorkspace();
			vi.stubGlobal('navigator', { ...navigator, locks: sharedLocks() });
			const created = notesStore.createNote({ title: 'trip' });
			await notesStore.flushNote(created.id);
			const shot = await photo('shot', bytes('saved on the second try'));
			vi.spyOn(idb, 'saveNote').mockRejectedValueOnce(
				new DOMException('Storage full', 'QuotaExceededError')
			);

			notesStore.updateNote(created.id, { images: [shot] });
			// Another window asks what is held while the first try is failing.
			let answered = false;
			const asked = getStoredAttachmentVersions(TEST_WORKSPACE).then((held) => {
				answered = true;
				return held;
			});
			await new Promise((resolve) => setTimeout(resolve, 200));
			expect(answered).toBe(false);

			// It is answered once the retry has stored the bytes.
			expect((await asked).get(`${created.id}::shot`)).toBe(shot.contentHash);
		});

		it('stops listing a photo whose bytes were never saved', async () => {
			const ghost = await photo('ghost', bytes('never saved'), { name: 'ghost.png' });
			const kept = await photo('kept', bytes('saved'));
			await putNote(TEST_WORKSPACE, note('trip', [kept]));

			const stored = await boot({
				...note('trip', [
					{ ...kept, dataUrl: '' },
					{ ...ghost, dataUrl: '' }
				]),
				body: `before\n${photoMarker(ghost)}\nafter`
			});

			expect(photoBytes(stored)).toEqual({ kept: bytes('saved') });
			expect(stored?.body).toBe('before\nafter');
		});
	});

	it('downloads everything once on a device that never recorded what the relay holds', async () => {
		const shot = await photo('shot', bytes('the photo'));
		const other = await otherDevice(relay, identity);
		await other.save(note('trip', [shot]));
		await other.sync();
		await phoneSync();
		// A device updated from an app version that kept no such record.
		await deleteSyncState(TEST_WORKSPACE, syncControlKeys(identity.accountId).relayAttachments);
		phoneCursors.length = 0;

		await phoneSync();

		expect(phoneCursors[0]).toBe(0);
		expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: shot.dataUrl });
		// It learned what the relay holds: the next sync starts where this one ended.
		phoneCursors.length = 0;
		await phoneSync();
		expect(phoneCursors[0]).toBeGreaterThan(0);
	});

	it('opens an earlier version of a note with the photo as it was then', async () => {
		const other = await otherDevice(relay, identity);
		await other.save(note('trip', [await photo('shot', bytes('first crop'))]));
		await other.sync();
		await other.save(
			note('trip', [await photo('shot', bytes('second crop'), { editedAt: 20 })], 20)
		);
		await other.sync();
		// The phone only ever received the latest.
		await phoneSync();
		expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: bytes('second crop') });

		const versions = await loadNoteHistory(identity, 'trip');
		expect(versions).toHaveLength(2);
		const [latest, earlier] = await Promise.all(
			versions.map((version) => hydrateHistoryNote(identity, version))
		);

		expect(photoBytes(latest.note)).toEqual({ shot: bytes('second crop') });
		expect(photoBytes(earlier.note)).toEqual({ shot: bytes('first crop') });
		expect(latest.missingAttachments + earlier.missingAttachments).toBe(0);
	});
});
