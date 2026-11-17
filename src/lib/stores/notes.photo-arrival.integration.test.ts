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
import { createSyncIdentity, type SyncIdentity } from '#lib/syncPairing.js';
import { openDB } from 'idb';
import {
	deleteSyncState,
	getAllNotesMetadata,
	hydrateNoteAttachments,
	putNote,
	resolveDbName
} from '#lib/db/idb.js';
import * as idb from '#lib/db/idb.js';
import { hydrateHistoryNote, loadNoteHistory } from '#lib/historyClient.js';
import { SyncStore, syncStore } from './sync.svelte';
import { notesStore } from './notes.svelte';
import { syncSnapshot, type SyncSnapshot } from '#lib/syncRecords.js';
import type { Note, NoteImage } from '#lib/types.js';
import { sha256 } from '#lib/syncHash.js';
import { seedTestKeyring, TEST_WORKSPACE } from '../../tests/workspace';

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
	options: { limit?: number; afterUpload?: () => Promise<void> } = {}
): void {
	vi.spyOn(client as unknown as { sendSyncRequest: Send }, 'sendSyncRequest').mockImplementation(
		async (_path, payload) => {
			const body = JSON.parse(payload) as {
				cursor: number;
				envelopes: unknown[];
				deleteSlots: Array<{ id: string; slot: string }>;
				limit?: number;
			};
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
			const result = await client.sync(
				syncSnapshot({ notes: device.notes }),
				false,
				false,
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

/** Cards scroll into view: a photo with nothing to show asks for its bytes. */
async function phoneShowsCards(): Promise<void> {
	for (const item of notesStore.notes) {
		if ((item.images ?? []).some((image) => !image.thumbUrl && !image.dataUrl))
			await notesStore.ensureNoteAttachments(item.id);
	}
}

/** What the phone holds on disk for a note, photos in full. */
async function phoneStored(id: string): Promise<Note> {
	const stored = (await getAllNotesMetadata(TEST_WORKSPACE)).find((item) => item.id === id);
	expect(stored, `note ${id} on the phone`).toBeDefined();
	return hydrateNoteAttachments(TEST_WORKSPACE, stored!);
}

/** Reach into the phone's storage, as damage or an older app version would have left it. */
async function phoneBytesStore(
	change: (store: {
		put(value: { mime: string; bytes: Uint8Array }, key: string): Promise<unknown>;
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

function photoBytes(stored: Note): Record<string, string> {
	return Object.fromEntries((stored.images ?? []).map((image) => [image.id, image.dataUrl]));
}

describe('photos reaching a second device', () => {
	let relay: RelayStore;
	let identity: SyncIdentity;
	/** Attachments the phone asked the relay for by name. */
	let askedByName: number;

	beforeEach(async () => {
		localStorage.clear();
		seedTestKeyring();
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		relay = new RelayStore(testDb());
		identity = createSyncIdentity();
		await relay.createAccount(identity.accountId, 'credential');
		syncStore.account = identity;
		wire(syncStore, relay);
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
		notesStore.labels = [];
		notesStore.deletedNoteIds = {};
		notesStore.lastPersistError = null;
	});

	afterEach(() => {
		const internals = notesStore as unknown as {
			dirty: boolean;
			syncPushTimer: ReturnType<typeof setTimeout> | null;
			attachmentHydrationFailures: Set<string>;
			attachmentsRelayLacks: Set<string>;
			unreadableAttachmentChecks: number;
		};
		internals.attachmentsRelayLacks.clear();
		internals.unreadableAttachmentChecks = 0;
		if (internals.syncPushTimer) clearTimeout(internals.syncPushTimer);
		internals.syncPushTimer = null;
		internals.dirty = false;
		internals.attachmentHydrationFailures.clear();
		vi.restoreAllMocks();
		syncStore.account = null;
		syncStore.lastError = null;
		notesStore.notes = [];
		cleanupTestDbs();
	});

	it('stores a photo that arrives after its note, with the card on screen in between', async () => {
		const shot = await photo('shot', bytes('the photo'));
		// The phone syncs after each of the other device's upload rounds: first it
		// gets the note alone, then the photo.
		const seenByPhone: string[] = [];
		const other = await otherDevice(relay, identity, async () => {
			await phoneSync();
			await phoneShowsCards();
			seenByPhone.push((await phoneStored('trip')).images?.[0]?.dataUrl ?? 'no photo listed');
		});
		await other.save(note('trip', [shot]));
		await other.sync();
		await phoneSync();

		expect(seenByPhone).toEqual(['', shot.dataUrl]);
		expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: shot.dataUrl });
		expect(notesStore.notes[0].images?.[0].thumbUrl).toBeTruthy();
		expect(syncStore.lastError).toBeNull();
		expect(notesStore.lastPersistError).toBeNull();
	});

	it('stores every photo of a note that uploads over several rounds', async () => {
		const shots = await Promise.all(
			['a', 'b', 'c', 'd', 'e'].map((id) => photo(id, bytes(`photo ${id}`)))
		);
		const other = await otherDevice(relay, identity, async () => {
			await phoneSync();
			await phoneShowsCards();
		});
		await other.save(note('album', shots));
		await other.sync();
		await phoneSync();

		expect(photoBytes(await phoneStored('album'))).toEqual(
			Object.fromEntries(shots.map((shot) => [shot.id, shot.dataUrl]))
		);
		expect(syncStore.lastError).toBeNull();
	});

	it('stores the new bytes of a photo edited on the other device', async () => {
		const other = await otherDevice(relay, identity);
		await other.save(note('trip', [await photo('shot', bytes('first crop'))]));
		await other.sync();
		await phoneSync();
		await phoneShowsCards();
		expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: bytes('first crop') });

		// The edit keeps the photo's id. The phone syncs between the note and the bytes.
		const edited = await otherDevice(relay, identity, async () => {
			await phoneSync();
			await phoneShowsCards();
		});
		edited.notes = other.notes;
		await edited.save(
			note('trip', [await photo('shot', bytes('second crop'), { editedAt: 20 })], 20)
		);
		await edited.sync();
		await phoneSync();

		expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: bytes('second crop') });
		expect(syncStore.lastError).toBeNull();

		// A later edit on the phone uploads the note again, not the earlier crop.
		notesStore.togglePin('trip');
		await notesStore.flushNote('trip');
		await phoneSync();
		await edited.sync();
		const kept = edited.notes.find((item) => item.id === 'trip');
		expect(kept?.pinned).toBe(true);
		expect(kept?.images?.[0].dataUrl).toBe(bytes('second crop'));
	});

	it('still stores a photo when the phone edits its note before the bytes arrive', async () => {
		const shot = await photo('shot', bytes('the photo'));
		let edited = false;
		const other = await otherDevice(relay, identity, async () => {
			await phoneSync();
			await phoneShowsCards();
			if (edited) return;
			edited = true;
			notesStore.togglePin('trip');
			await notesStore.flushNote('trip');
			await phoneSync();
		});
		await other.save(note('trip', [shot]));
		await other.sync();
		await phoneSync();
		await other.sync();

		const stored = await phoneStored('trip');
		expect(photoBytes(stored)).toEqual({ shot: shot.dataUrl });
		expect(stored.pinned).toBe(true);
		// The other device keeps its bytes and gets the pin.
		const kept = other.notes.find((item) => item.id === 'trip');
		expect(kept?.pinned).toBe(true);
		expect(kept?.images?.[0].dataUrl).toBe(shot.dataUrl);
		expect(syncStore.lastError).toBeNull();
	});

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
		expect(syncStore.lastError).toBeNull();
	});

	it('sends a photo taken on the phone to the other device', async () => {
		const shot = await photo('shot', bytes('taken here'));
		const created = notesStore.createNote({ title: 'From the phone' });
		await notesStore.flushNote(created.id, { images: [shot] });
		await phoneSync();

		const other = await otherDevice(relay, identity);
		await other.sync();

		expect(other.notes.find((item) => item.id === created.id)?.images?.[0].dataUrl).toBe(
			shot.dataUrl
		);
		expect(syncStore.lastError).toBeNull();
	});

	it('fetches again a photo whose bytes this device has lost', async () => {
		const shot = await photo('shot', bytes('the photo'));
		const other = await otherDevice(relay, identity);
		await other.save(note('trip', [shot]));
		await other.sync();
		await phoneSync();
		expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: shot.dataUrl });

		// The bytes go, long after the sync that brought them.
		await phoneBytesStore((store) => store.delete('trip::shot'));
		expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: '' });

		await phoneSync();

		expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: shot.dataUrl });
		expect(syncStore.lastError).toBeNull();
	});

	it('asks once for a photo the relay does not hold yet, then leaves it to the sync', async () => {
		const shot = await photo('shot', bytes('the photo'));
		const other = await otherDevice(relay, identity);
		// The other device has uploaded the note and not the photo.
		await other.save(note('trip', [{ ...shot, dataUrl: '' }]));
		await other.sync();

		await phoneSync();
		await phoneSync();
		expect(askedByName).toBe(1);

		await other.save(note('trip', [shot]));
		await other.sync();
		await phoneSync();

		expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: shot.dataUrl });
		expect(askedByName).toBe(1);
	});

	/**
	 * What an earlier version of the app left behind: the note names the second crop,
	 * the bytes under it are the first, no check has run yet, and an edit is waiting,
	 * so the next sync reads the note's photo to send it.
	 */
	async function phoneHoldingTheCropBefore() {
		const other = await otherDevice(relay, identity);
		await other.save(note('trip', [await photo('shot', bytes('first crop'))]));
		await other.sync();
		await other.save(
			note('trip', [await photo('shot', bytes('second crop'), { editedAt: 20 })], 20)
		);
		await other.sync();
		await phoneSync();
		await phoneBytesStore((store) =>
			store.put({ mime: 'image/png', bytes: new TextEncoder().encode('first crop') }, 'trip::shot')
		);
		await deleteSyncState(TEST_WORKSPACE, 'scrapscache-attachments-verified');
		expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: bytes('first crop') });
		notesStore.togglePin('trip');
		await notesStore.flushNote('trip');
		return other;
	}

	/** The other device after a sync: the relay's copy of the note. */
	async function onTheRelay(other: Awaited<ReturnType<typeof otherDevice>>) {
		await other.sync();
		const trip = other.notes.find((item) => item.id === 'trip');
		return { pinned: trip?.pinned, shot: trip?.images?.[0].dataUrl };
	}

	it('replaces stored bytes that are not the version their note names', async () => {
		const other = await phoneHoldingTheCropBefore();

		await phoneSync();

		expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: bytes('second crop') });
		// The relay keeps the second crop: the first was not uploaded over it.
		expect(await onTheRelay(other)).toEqual({ pinned: true, shot: bytes('second crop') });
		// One check a workspace: later syncs do not read every photo again.
		const read = vi.spyOn(idb, 'hydrateNoteAttachments');
		await phoneSync();
		expect(read).not.toHaveBeenCalled();
	});

	it.each([
		[
			'the relay cannot be asked',
			() => vi.mocked(syncStore.authorizedFetch).mockRejectedValueOnce(new Error('offline'))
		],
		[
			'the bytes cannot be read',
			() => vi.spyOn(idb, 'hydrateNoteAttachments').mockRejectedValueOnce(new Error('read'))
		]
	])('does not sync mismatched bytes while %s', async (_why, fail) => {
		const other = await phoneHoldingTheCropBefore();

		// Unchecked, the first crop would upload in place of the second.
		fail();
		expect(await notesStore.syncWithCloudManual()).toBe(false);
		expect(await onTheRelay(other)).toEqual({ pinned: false, shot: bytes('second crop') });

		// The next sync checks again, repairs, and sends the edit.
		await phoneSync();
		expect(await onTheRelay(other)).toEqual({ pinned: true, shot: bytes('second crop') });
		expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: bytes('second crop') });
	});

	it('keeps stored bytes when the relay holds no other version of them', async () => {
		const shot = await photo('shot', bytes('the photo'));
		const other = await otherDevice(relay, identity);
		await other.save(note('trip', [shot]));
		await other.sync();
		await phoneSync();

		// The note names a version that was never stored anywhere.
		const relabelled = { ...notesStore.notes[0] };
		relabelled.images = [{ ...relabelled.images![0], contentHash: 'never-stored' }];
		await putNote(TEST_WORKSPACE, relabelled);
		notesStore.notes = [relabelled];
		await deleteSyncState(TEST_WORKSPACE, 'scrapscache-attachments-verified');

		await phoneSync();

		expect(photoBytes(await phoneStored('trip'))).toEqual({ shot: shot.dataUrl });
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
