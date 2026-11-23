import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, cleanupTestDbs } from '#lib/server/testDb.js';
import { SyncStore as RelayStore } from '#lib/server/syncStore.js';
import {
	createSyncIdentity,
	decryptSyncPayload,
	encryptSyncPayload,
	randomOpaqueId,
	type SyncIdentity
} from '#lib/syncPairing.js';
import {
	getAllLabels,
	getAllNotesMetadata,
	getSyncOutboxKeys,
	hydrateNoteAttachments,
	saveLabel,
	putNote,
	waitForDeviceWrites
} from '#lib/db/idb.js';
import type { StoredProfile } from '#lib/profiles.js';
import { readStoredTombstones } from '#lib/syncTombstones.js';
import type { SyncNote, SyncRecordPayload } from '#lib/syncRecords.js';
import { sha256 } from '#lib/syncHash.js';
import type { Note } from '#lib/types.js';
import { notesStore } from './notes.svelte';
import { syncScheduler } from './syncScheduler';
import { profileCoordinator } from './profiles.svelte';
import { PROFILE_META_KEY, syncStore, type SyncAccount } from './sync.svelte';
import { kanbanStore } from './kanban.svelte';
import { createKanbanBoard } from '#lib/kanban.js';
import { seedTestKeyring, TEST_WORKSPACE } from '../../tests/workspace';

// A workspace left with changes still to send is not open any more, and may never
// be opened again on this device. What it owes the relay is sent all the same, from
// its database, while another workspace is on screen.

type Send = (
	path: string,
	payload: string,
	uploadBytes: number,
	indicate: boolean,
	account: SyncAccount,
	signal?: AbortSignal
) => Promise<{ success: boolean; data?: unknown; error?: string }>;

function note(id: string, title = id, at = 1): Note {
	return {
		id,
		title,
		body: '',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: at,
		reminder: null,
		labels: []
	};
}

describe('a workspace that is not open', () => {
	let relay: RelayStore;
	let identity: SyncIdentity;
	let left: StoredProfile;
	let here: StoredProfile;
	/** Accounts whose requests the relay does not answer; only giving up ends them. */
	let silent: Set<string>;
	let requests: string[];
	/** The relay stores one more upload, answers it, and then goes silent. */
	let stopAnsweringAfterUpload: boolean;
	/** Requests the relay took and has not answered. */
	let unanswered: number;

	async function relayRecords(account: SyncIdentity = identity): Promise<SyncRecordPayload[]> {
		const records: SyncRecordPayload[] = [];
		let cursor = 0;
		for (;;) {
			const page = await relay.sync(account.accountId, cursor, [], [], 50);
			for (const envelope of page.envelopes)
				records.push(
					decryptSyncPayload(
						account.syncKey,
						envelope.ciphertext,
						envelope.slot
					) as SyncRecordPayload
				);
			cursor = page.cursor;
			if (!page.hasMore) return records;
		}
	}

	async function relayNoteTitles(account: SyncIdentity = identity): Promise<string[]> {
		return (await relayRecords(account))
			.flatMap((record) => (record.kind === 'note' ? [record.value.title] : []))
			.sort();
	}

	/** Another device of an account writes a record to the relay. */
	async function otherDeviceWrites(
		payload: SyncRecordPayload,
		key: string,
		account: SyncIdentity = identity
	): Promise<void> {
		const slot = await sha256(`${account.syncKey}\u0000${key}`);
		const caughtUp = (await relay.sync(account.accountId, 0, [], [], 50)).cursor;
		const written = await relay.sync(
			account.accountId,
			caughtUp,
			[
				{
					id: randomOpaqueId(),
					slot,
					expectedId: null,
					ciphertext: encryptSyncPayload(account.syncKey, payload, slot)
				}
			],
			[],
			50
		);
		expect(written.writesAccepted).toBe(true);
	}

	/** The relay answers again, and the browser reports the connection back. */
	function reconnect(): void {
		silent.clear();
		window.dispatchEvent(new Event('online'));
	}

	async function open(profile: StoredProfile): Promise<void> {
		syncStore.activateProfile(profile);
		await notesStore.reloadForProfile();
	}

	/**
	 * Every workspace has caught up, as on a device that has been open a while: a
	 * load asks all of them to. The requests counted from here on are the test's own.
	 */
	async function caughtUp(): Promise<void> {
		await vi.waitFor(() =>
			expect(syncStore.profiles.some(({ id }) => syncScheduler.syncing(id))).toBe(false)
		);
		requests.length = 0;
	}

	beforeEach(async () => {
		localStorage.clear();
		seedTestKeyring();
		// Past its first start: a new workspace here gets no starter notes.
		localStorage.setItem('scrapscache-seeded', '1');
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		relay = new RelayStore(testDb());
		identity = createSyncIdentity();
		await relay.createAccount(identity.accountId, 'credential');
		left = {
			id: `left-${randomOpaqueId()}`,
			name: 'Left',
			syncKey: identity.syncKey,
			createdAt: 1
		};
		here = { id: `here-${randomOpaqueId()}`, name: 'Here', syncKey: '', createdAt: 2 };
		silent = new Set();
		requests = [];
		stopAnsweringAfterUpload = false;
		unanswered = 0;
		vi.spyOn(
			syncStore as unknown as { sendSyncRequest: Send },
			'sendSyncRequest'
		).mockImplementation(async (_path, payload, _bytes, _indicate, account, signal) => {
			requests.push(account.accountId);
			if (silent.has(account.accountId)) {
				unanswered += 1;
				return new Promise((resolve) =>
					signal?.addEventListener('abort', () => {
						unanswered -= 1;
						resolve({ success: false, error: 'Sync was cancelled' });
					})
				);
			}
			const body = JSON.parse(payload) as {
				cursor: number;
				envelopes: unknown[];
				deleteSlots: Array<{ id: string; slot: string }>;
				limit?: number;
			};
			const data = await relay.sync(
				account.accountId,
				body.cursor,
				body.envelopes as never,
				body.deleteSlots,
				body.limit ?? 12
			);
			if (stopAnsweringAfterUpload && data.writesAccepted && body.envelopes.length > 0) {
				stopAnsweringAfterUpload = false;
				silent.add(account.accountId);
			}
			return { success: true, data };
		});
		vi.spyOn(syncStore, 'authorizedFetch').mockImplementation(async () =>
			Response.json({ error: 'Not found' }, { status: 404 })
		);
		syncStore.profiles = [left, here];
		await open(here);
		await caughtUp();
	});

	afterEach(async () => {
		silent.clear();
		syncStore.onSyncStart = null;
		syncStore.onSyncEnd = null;
		await syncScheduler.reset();
		vi.restoreAllMocks();
		syncStore.activateLocalWorkspace(TEST_WORKSPACE);
		syncStore.profiles = [];
		await notesStore.reloadForProfile();
		await syncScheduler.reset();
		await cleanupTestDbs();
	});

	it('sends what it still owes the relay without being opened', async () => {
		await putNote(left.id, note('unsent', 'Written before leaving'), ['note:unsent']);
		await waitForDeviceWrites(left.id);
		// The cloud turns while it is sent, as for any sync, and stops with it.
		const cloud: string[] = [];
		const asked = requests.length;
		syncStore.onSyncStart = () => cloud.push(`turns after ${requests.length - asked} requests`);
		syncStore.onSyncEnd = () =>
			cloud.push(requests.length > asked ? 'stops after the relay was asked' : 'stops unasked');

		// Nobody names the workspace: every workspace catches up, and so does this one.
		syncScheduler.catchUpAll();
		await vi.waitFor(async () => expect(await getSyncOutboxKeys(left.id)).toEqual([]), {
			timeout: 5_000
		});
		await vi.waitFor(() => expect(syncScheduler.syncing(left.id)).toBe(false));

		expect(cloud).toEqual(['turns after 0 requests', 'stops after the relay was asked']);
		expect(await relayNoteTitles()).toEqual(['Written before leaving']);
		expect(await getSyncOutboxKeys(left.id)).toEqual([]);
		// Nothing of it shows in the workspace that is open.
		expect(syncStore.activeId).toBe(here.id);
		expect(notesStore.notes).toEqual([]);
		expect(syncStore.lastError).toBeNull();
		expect(notesStore.lastPersistError).toBeNull();
		expect(notesStore.syncing).toBe(false);
	});

	// Labels are renamed without the sync lock, by a window that has the workspace
	// open. A sync that read them before waiting on the relay must not write that
	// older copy back over the rename.
	it('keeps a label renamed in another window while it waited on the relay', async () => {
		await saveLabel(left.id, { id: 'renamed', name: 'Before', createdAt: 1, updatedAt: 1 });
		// Listing a photo this device has no bytes for makes the sync ask the relay for it.
		const photo = { id: 'photo', mime: 'image/png', dataUrl: '', createdAt: 1, contentHash: 'h' };
		await putNote(left.id, { ...note('with-photo'), images: [photo] }, ['note:with-photo']);
		await waitForDeviceWrites(left.id);
		await otherDeviceWrites(
			{ kind: 'label', value: { id: 'theirs', name: 'Theirs', createdAt: 1, updatedAt: 1 } },
			'label:theirs'
		);
		let relayAsked = false;
		let answer: () => void = () => undefined;
		const waiting = new Promise<void>((resolve) => (answer = resolve));
		vi.spyOn(syncStore, 'authorizedFetch').mockImplementation(async () => {
			relayAsked = true;
			await waiting;
			return Response.json({ error: 'Not found' }, { status: 404 });
		});

		const synced = syncScheduler.request(left.id);
		await vi.waitFor(() => expect(relayAsked).toBe(true));
		await saveLabel(left.id, { id: 'renamed', name: 'After', createdAt: 1, updatedAt: 50 });
		await waitForDeviceWrites(left.id);
		answer();

		expect(await synced).toBe(true);
		const stored = (await getAllLabels(left.id)).map((label) => [label.id, label.name]).sort();
		expect(stored).toEqual([
			['renamed', 'After'],
			['theirs', 'Theirs']
		]);
	});

	it('sends an attachment with the note that lists it', async () => {
		const dataUrl = `data:image/png;base64,${btoa('photo bytes')}`;
		const photo = {
			id: 'photo',
			mime: 'image/png',
			dataUrl,
			createdAt: 1,
			contentHash: await sha256(dataUrl)
		};
		await putNote(left.id, { ...note('with-photo'), images: [photo] }, [
			'note:with-photo',
			'attachment:photo'
		]);
		await waitForDeviceWrites(left.id);

		await syncScheduler.request(left.id);

		const records = await relayRecords();
		const sent = records.find((record) => record.kind === 'note');
		expect(sent?.kind === 'note' && sent.value.images?.map((image) => image.id)).toEqual(['photo']);
		expect(
			records.flatMap((record) => (record.kind === 'attachment' ? [record.value.dataUrl] : []))
		).toEqual([dataUrl]);
		expect(await getSyncOutboxKeys(left.id)).toEqual([]);
	});

	it('saves what other devices changed into its database', async () => {
		await putNote(left.id, note('mine', 'Mine'), ['note:mine']);
		await putNote(left.id, note('gone', 'Deleted elsewhere'));
		await waitForDeviceWrites(left.id);
		await otherDeviceWrites(
			{ kind: 'note', value: note('theirs', 'Theirs') as SyncNote },
			'note:theirs'
		);
		await otherDeviceWrites(
			{ kind: 'note-tombstone', id: 'gone', deletedAt: 5 },
			'note-tombstone:gone'
		);

		await syncScheduler.request(left.id);

		expect((await getAllNotesMetadata(left.id)).map((item) => item.title).sort()).toEqual([
			'Mine',
			'Theirs'
		]);
		expect((await readStoredTombstones(left.id)).notes).toEqual({ gone: 5 });
		expect(await relayNoteTitles()).toEqual(['Mine', 'Theirs']);
		// The open workspace's notes and deletes are its own.
		expect(notesStore.notes).toEqual([]);
		expect(notesStore.deletedNoteIds).toEqual({});
		expect(await getAllNotesMetadata(here.id)).toEqual([]);

		// Opened later, it shows what the sync saved.
		await open(left);
		expect(notesStore.notes.map((item) => item.title).sort()).toEqual(['Mine', 'Theirs']);
		expect(notesStore.deletedNoteIds).toEqual({ gone: 5 });
	});

	// A workspace nobody has open still takes in what other devices changed: it is
	// in its database before it is opened, with nothing of its own to send.
	it('takes in what another device changed without being opened', async () => {
		await otherDeviceWrites(
			{ kind: 'note', value: note('theirs', 'Theirs') as SyncNote },
			'note:theirs'
		);
		expect(await getSyncOutboxKeys(left.id)).toEqual([]);

		// The connection comes back: every workspace catches up, shown or not.
		window.dispatchEvent(new Event('online'));
		await vi.waitFor(
			async () =>
				expect((await getAllNotesMetadata(left.id)).map((item) => item.title)).toEqual(['Theirs']),
			{ timeout: 5_000 }
		);
		await vi.waitFor(() => expect(syncScheduler.syncing(left.id)).toBe(false));

		// The window still shows its own workspace.
		expect(notesStore.notes).toEqual([]);
		// It has just caught up: being shown again a moment later asks nothing more.
		const asked = requests.length;
		await syncScheduler.catchUpAll();
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(requests).toHaveLength(asked);

		// Opened later, it shows what was saved without waiting for the relay.
		silent.add(identity.accountId);
		await open(left);
		expect(notesStore.notes.map((item) => item.title)).toEqual(['Theirs']);
	});

	// How a sync ended is recorded for the workspace it ran for. The indicator shows
	// the open workspace's, so another one's trouble is there once it is opened.
	it('records how its sync ended, and shows that once it is opened', async () => {
		await putNote(left.id, note('unsent', 'Refused by the relay'), ['note:unsent']);
		await waitForDeviceWrites(left.id);
		vi.spyOn(
			syncStore as unknown as { sendSyncRequest: Send },
			'sendSyncRequest'
		).mockResolvedValueOnce({ success: false, error: 'Account storage is full' });

		expect(await syncScheduler.request(left.id)).toBe(false);

		expect(syncStore.stateOf(left.id).lastError).toBe('Account storage is full');
		expect(syncStore.lastError).toBeNull();
		expect(syncStore.stateOf(here.id).lastError).toBeNull();

		syncStore.activateProfile(left);
		expect(syncStore.lastError).toBe('Account storage is full');
		await notesStore.reloadForProfile();
	});

	// Pairing gives this device a key. The workspace it gets syncs like any other
	// before a window opens it, so it starts as the account's copy: nothing this
	// device makes up for a workspace it opens (a board to show, a name) is sent.
	it('fills a newly paired workspace from the account before it is opened', async () => {
		const paired = createSyncIdentity();
		await relay.createAccount(paired.accountId, 'credential');
		await otherDeviceWrites(
			{ kind: 'note', value: note('theirs', 'Theirs') as SyncNote },
			'note:theirs',
			paired
		);
		await otherDeviceWrites(
			{ kind: 'board', value: { ...createKanbanBoard('Their board'), id: 'their-board' } },
			'board:their-board',
			paired
		);
		await otherDeviceWrites(
			{ kind: 'profile-meta', value: { name: 'Shared notes' } },
			PROFILE_META_KEY,
			paired
		);

		expect(await profileCoordinator.receiveLinkedKey(paired.syncKey)).toEqual({
			outcome: 'linked'
		});

		expect(syncStore.activeProfile).toMatchObject({
			syncKey: paired.syncKey,
			name: 'Shared notes'
		});
		expect(notesStore.notes.map((item) => item.title)).toEqual(['Theirs']);
		expect(kanbanStore.boards.map((board) => board.name)).toEqual(['Their board']);
		// Opening it sends nothing of this device's own.
		expect(await notesStore.flushSync()).toBe(true);
		const records = await relayRecords(paired);
		expect(
			records.flatMap((record) => (record.kind === 'board' ? [record.value.name] : []))
		).toEqual(['Their board']);
		expect(
			records.flatMap((record) => (record.kind === 'profile-meta' ? [record.value.name] : []))
		).toEqual(['Shared notes']);
		expect(await relayNoteTitles(paired)).toEqual(['Theirs']);
	});

	it('is not disturbed by a workspace switch, and is sent once the relay answers', async () => {
		const spare: StoredProfile = {
			id: `spare-${randomOpaqueId()}`,
			name: 'Spare',
			syncKey: '',
			createdAt: 3
		};
		syncStore.profiles = [left, here, spare];
		await putNote(left.id, note('unsent', 'Still to send'), ['note:unsent']);
		await waitForDeviceWrites(left.id);
		silent.add(identity.accountId);

		const sent = syncScheduler.request(left.id);
		await vi.waitFor(() => expect(requests).toHaveLength(1));
		expect(await profileCoordinator.switchTo(spare.id)).toEqual({ success: true });

		expect(syncStore.activeId).toBe(spare.id);
		expect(await getSyncOutboxKeys(left.id)).toEqual(['note:unsent']);
		expect(await relayNoteTitles()).toEqual([]);
		// The request it had out is still the only one: the switch did not touch it.
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(requests).toHaveLength(1);
		expect(syncScheduler.syncing(left.id)).toBe(true);

		reconnect();
		expect(await sent).toBe(true);
		expect(await relayNoteTitles()).toEqual(['Still to send']);
		expect(await getSyncOutboxKeys(left.id)).toEqual([]);
	});

	// A first upload takes several requests. Cut short, the rest of it is still
	// queued: the next sync must not take the workspace for sent.
	it('finishes a first upload that a rewrite of the workspace cut short', async () => {
		const titles = Array.from({ length: 20 }, (_, index) => `Note ${index + 10}`);
		// A workspace that just started syncing: the relay has nothing of it yet.
		await syncStore.clearAccountControlPlane(identity.accountId, left.id);
		// Never queued one by one, as the notes of such a workspace.
		for (const title of titles) await putNote(left.id, note(title, title));
		await putNote(left.id, note('queued', 'Queued'), ['note:queued']);
		await waitForDeviceWrites(left.id);
		stopAnsweringAfterUpload = true;

		const sent = syncScheduler.request(left.id);
		await vi.waitFor(() => expect(unanswered).toBe(1));
		const asked = requests.length;
		// As an import landing in it would: the round gives up its lock, and goes again.
		await syncScheduler.rewrite(left.id, async () => undefined);
		const sentFirst = await relayNoteTitles();
		expect(sentFirst.length).toBeGreaterThan(0);
		expect(sentFirst.length).toBeLessThan(21);
		await vi.waitFor(() => expect(requests.length).toBeGreaterThan(asked));

		reconnect();
		expect(await sent).toBe(true);

		expect(await relayNoteTitles()).toEqual([...titles, 'Queued'].sort());
		expect(await getSyncOutboxKeys(left.id)).toEqual([]);
	});

	it("neither waits for the open workspace's sync nor holds it up", async () => {
		const openIdentity = createSyncIdentity();
		await relay.createAccount(openIdentity.accountId, 'credential');
		const synced: StoredProfile = {
			id: `synced-${randomOpaqueId()}`,
			name: 'Synced',
			syncKey: openIdentity.syncKey,
			createdAt: 3
		};
		syncStore.profiles = [left, here, synced];
		await open(synced);
		await caughtUp();
		await putNote(left.id, note('unsent', 'Still to send'), ['note:unsent']);
		await waitForDeviceWrites(left.id);
		silent.add(identity.accountId);

		void syncScheduler.request(left.id);
		await vi.waitFor(() => expect(requests).toContain(identity.accountId));
		notesStore.createNote({ title: 'In the open workspace' });
		await waitForDeviceWrites(synced.id);

		// The open workspace syncs start to end while the other one's request is still out.
		expect(await notesStore.syncWithCloudManual()).toBe(true);
		expect(await relayNoteTitles(openIdentity)).toEqual(['In the open workspace']);
		expect(requests.filter((account) => account === identity.accountId)).toHaveLength(1);
		expect(syncScheduler.syncing(left.id)).toBe(true);
		expect(await getSyncOutboxKeys(left.id)).toEqual(['note:unsent']);
	});

	it('sends what was written before a switch that did not wait for the relay', async () => {
		await open(left);
		silent.add(identity.accountId);
		notesStore.createNote({ title: 'Written on a bad connection' });
		await waitForDeviceWrites(left.id);
		const flight = notesStore.syncWithCloudManual();
		await vi.waitFor(() => expect(requests).toHaveLength(1));

		expect(await profileCoordinator.switchTo(here.id)).toEqual({ success: true });
		expect(await relayNoteTitles()).toEqual([]);

		// The relay answers again; the workspace is never opened again, and the sync
		// asked for while it was open is the one that sends it.
		reconnect();
		expect(await flight).toBe(true);

		expect(syncStore.activeId).toBe(here.id);
		expect(await relayNoteTitles()).toEqual(['Written on a bad connection']);
		const stored = await getAllNotesMetadata(left.id);
		expect(stored.map((item) => item.title)).toEqual(['Written on a bad connection']);
		expect((await hydrateNoteAttachments(left.id, stored[0])).images ?? []).toEqual([]);
	});
});
