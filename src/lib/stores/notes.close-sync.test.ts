import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/imageThumb.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/imageThumb.js')>();
	return { ...actual, makeImageThumbDataUrl: vi.fn(async () => null) };
});

import { clearSyncOutbox, getSyncOutboxKeys, markSyncOutbox, putNote } from '#lib/db/idb.js';
import * as idb from '#lib/db/idb.js';
import { relaySync, syncStore } from './sync.svelte';
import { relay as appRelay } from '#lib/relayClient.js';
import { syncSnapshot } from '#lib/syncRecords.js';
import { notesStore } from './notes.svelte';
import { syncScheduler } from './syncScheduler';
import type { Note } from '#lib/types.js';
import { linkTestWorkspace, unlinkTestWorkspace } from '../../tests/syncing';
import { emptyWorkspace, TEST_WORKSPACE } from '../../tests/workspace';

function noteWithPhoto(dataUrl: string): Note {
	return {
		id: 'photo-note',
		title: 'Photo',
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
		images: [
			{
				id: 'photo-1',
				mime: 'image/png',
				dataUrl,
				createdAt: 1,
				contentHash: 'hash-photo-1'
			}
		]
	};
}

async function settleIndexedDb(): Promise<void> {
	for (let pass = 0; pass < 4; pass += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

/** The relay's answer to each sync of the open workspace. */
function relayAnswers(answer: typeof relaySync.sync) {
	return vi.spyOn(relaySync, 'sync').mockImplementation(answer);
}

describe('syncing when a note closes', () => {
	beforeEach(async () => {
		await clearSyncOutbox(TEST_WORKSPACE, await getSyncOutboxKeys(TEST_WORKSPACE));
		linkTestWorkspace();
	});

	afterEach(async () => {
		vi.clearAllTimers();
		vi.useRealTimers();
		await syncScheduler.reset();
		vi.restoreAllMocks();
		unlinkTestWorkspace();
		notesStore.notes = [];
		notesStore.loaded = true;
		await emptyWorkspace(TEST_WORKSPACE);
		await clearSyncOutbox(TEST_WORKSPACE, await getSyncOutboxKeys(TEST_WORKSPACE));
	});

	it('skips the cloud request when there are no pending records', async () => {
		const flush = vi.spyOn(syncScheduler, 'request').mockResolvedValue(true);

		expect(await syncScheduler.flush(syncStore.activeId)).toBe(false);
		expect(flush).not.toHaveBeenCalled();
	});

	it('flushes the debounce immediately when a record is pending', async () => {
		await markSyncOutbox(TEST_WORKSPACE, ['note:note-1']);
		const flush = vi.spyOn(syncScheduler, 'request').mockResolvedValue(true);

		expect(await syncScheduler.flush(syncStore.activeId)).toBe(true);
		expect(flush).toHaveBeenCalledOnce();
	});

	it('turns the cloud icon while the request runs', async () => {
		await markSyncOutbox(TEST_WORKSPACE, ['note:note-1']);
		const turned: string[] = [];
		syncStore.onSyncStart = () => turned.push('start');
		syncStore.onSyncEnd = () => turned.push('end');
		const sync = relayAnswers(async () => {
			turned.push('request');
			return { success: true, snapshot: syncSnapshot() };
		});

		try {
			expect(await syncScheduler.flush(syncStore.activeId)).toBe(true);
		} finally {
			syncStore.onSyncStart = null;
			syncStore.onSyncEnd = null;
		}
		expect(sync).toHaveBeenCalledOnce();
		expect(turned).toEqual(['start', 'request', 'end']);
	});

	it('manual sync takes the place of the sync waiting for changes to pause', async () => {
		await markSyncOutbox(TEST_WORKSPACE, ['note:note-1']);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const sync = relayAnswers(async () => {
			await clearSyncOutbox(TEST_WORKSPACE, ['note:note-1']);
			return { success: true, snapshot: syncSnapshot() };
		});
		syncScheduler.changed(TEST_WORKSPACE);

		expect(await syncScheduler.request(syncStore.activeId)).toBe(true);
		await vi.advanceTimersByTimeAsync(10_000);

		expect(sync).toHaveBeenCalledOnce();
	});

	it('does not count a photo this device holds no bytes for as a failed upload', async () => {
		// Nothing of it is here to read, so nothing here failed; a sync settles it.
		const note = noteWithPhoto('');
		await putNote(TEST_WORKSPACE, note, ['note:photo-note', 'attachment:photo-1']);
		notesStore.notes = [note];
		notesStore.lastPersistError = null;
		relayAnswers(async () => ({ success: true, snapshot: syncSnapshot() }));

		// Its card scrolls into view, then the next sync runs.
		await notesStore.ensureNoteAttachments(note.id);

		expect(await syncScheduler.request(syncStore.activeId)).toBe(true);
		expect(syncStore.lastError).toBeNull();
		expect(notesStore.lastPersistError).toBeNull();
	});

	it('warns after a sync while a photo on this device cannot be read', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const note = noteWithPhoto('');
		await putNote(TEST_WORKSPACE, note, ['note:photo-note', 'attachment:photo-1']);
		notesStore.notes = [note];
		vi.spyOn(idb, 'hydrateNoteAttachments').mockRejectedValue(new Error('read failed'));
		relayAnswers(async () => ({ success: true, snapshot: syncSnapshot() }));

		expect(await syncScheduler.request(syncStore.activeId)).toBe(true);
		expect(syncStore.lastError).toBe(
			'Synced, but some photos could not be prepared for upload. They will retry on the next sync.'
		);
	});

	it('does not replace the cloud copy while a listed photo is not on this device', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const note = noteWithPhoto('');
		await putNote(TEST_WORKSPACE, note);
		notesStore.notes = [note];
		vi.spyOn(appRelay, 'reauthenticate').mockResolvedValue();
		vi.spyOn(relaySync, 'read').mockResolvedValue({
			success: true,
			snapshot: syncSnapshot(),
			control: { cursor: 4 }
		});
		const sync = relayAnswers(async () => ({ success: true, snapshot: syncSnapshot() }));

		expect(await notesStore.forcePushWorkspace(TEST_WORKSPACE)).toEqual({
			success: false,
			error: expect.stringMatching(/Replacing the cloud copy was not started/)
		});
		// Nothing landed: the note is as it was, nothing is queued, nothing was sent.
		expect((await idb.getAllNotesMetadata(TEST_WORKSPACE))[0].updatedAt).toBe(1);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
		expect(await idb.getSyncState(TEST_WORKSPACE, 'cursor')).toBeUndefined();
		expect(sync).not.toHaveBeenCalled();
		expect(notesStore.lastPersistError).toMatch(/Replacing the cloud copy was not started/);
	});

	it('replaces the cloud copy from the database, whatever bytes this window has loaded', async () => {
		await putNote(TEST_WORKSPACE, noteWithPhoto('data:image/png;base64,iVBORw0KGgo='));
		await idb.waitForDeviceWrites(TEST_WORKSPACE);
		// Memory holds the note without its bytes, as after any durable write.
		notesStore.notes = [noteWithPhoto('')];
		vi.spyOn(appRelay, 'reauthenticate').mockResolvedValue();
		vi.spyOn(relaySync, 'read').mockResolvedValue({
			success: true,
			snapshot: syncSnapshot(),
			control: { cursor: 4 }
		});
		const sync = relayAnswers(async (_profile, local) => {
			// Every record is queued, and the upload reads the photo from the database.
			expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(
				expect.arrayContaining(['note:photo-note', 'attachment:photo-1'])
			);
			expect(local.notes[0].images?.[0].dataUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
			return { success: true, snapshot: local };
		});

		expect(await notesStore.forcePushWorkspace(TEST_WORKSPACE)).toEqual({ success: true });
		expect(sync).toHaveBeenCalled();
		// The sync state of the copy that was read landed with it.
		expect(await idb.getSyncState(TEST_WORKSPACE, 'cursor')).toBe(4);
	});

	it('does not go again by itself for what a sync that settled left queued', async () => {
		notesStore.notes = [noteWithPhoto('')];
		await markSyncOutbox(TEST_WORKSPACE, ['attachment:photo-1']);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const sync = relayAnswers(async () => ({ success: true, snapshot: syncSnapshot() }));

		expect(await syncScheduler.request(syncStore.activeId)).toBe(true);
		await vi.advanceTimersByTimeAsync(10 * 60_000);

		expect(sync).toHaveBeenCalledOnce();
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(['attachment:photo-1']);
	});

	it('tries again by itself, later each time, while the relay cannot be reached', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await markSyncOutbox(TEST_WORKSPACE, ['note:note-1']);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const sync = relayAnswers(async () => ({ success: false, error: 'Sync network error' }));

		expect(await syncScheduler.request(syncStore.activeId)).toBe(false);
		// Not at once: whoever asked has been told, and the relay will not answer now.
		await vi.advanceTimersByTimeAsync(3_000);
		expect(sync).toHaveBeenCalledTimes(1);
		// From 5 seconds, doubling, each varied by a fifth.
		await vi.advanceTimersByTimeAsync(3_500);
		await settleIndexedDb();
		expect(sync).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(7_000);
		expect(sync).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(6_000);
		await settleIndexedDb();
		expect(sync).toHaveBeenCalledTimes(3);
	});

	it('does not try again by itself when nothing is left to send', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const sync = relayAnswers(async () => ({ success: false, error: 'Sync network error' }));

		expect(await syncScheduler.request(syncStore.activeId)).toBe(false);
		await vi.advanceTimersByTimeAsync(10 * 60_000);

		expect(sync).toHaveBeenCalledOnce();
	});

	it('does not try again by itself what the relay refused', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await markSyncOutbox(TEST_WORKSPACE, ['note:note-1']);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const sync = relayAnswers(async () => ({
			success: false,
			error: 'Sync incomplete: account storage quota prevented some uploads',
			refused: true
		}));

		expect(await syncScheduler.request(syncStore.activeId)).toBe(false);
		await vi.advanceTimersByTimeAsync(10 * 60_000);

		expect(sync).toHaveBeenCalledOnce();
	});

	it('syncs at once when the browser comes online', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await markSyncOutbox(TEST_WORKSPACE, ['note:note-1']);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		let reachable = false;
		const sync = relayAnswers(async () => {
			if (!reachable) return { success: false, error: 'Sync network error' };
			await clearSyncOutbox(TEST_WORKSPACE, ['note:note-1']);
			return { success: true, snapshot: syncSnapshot() };
		});
		await syncScheduler.request(syncStore.activeId);
		reachable = true;

		window.dispatchEvent(new Event('online'));
		await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(2));
		await vi.waitFor(() => expect(notesStore.syncing).toBe(false));

		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
		// What was due again after the failure has been sent: nothing more is asked.
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(sync).toHaveBeenCalledTimes(2);
	});

	it('clears attachment hydration warning on successful sync once attachments are healthy', async () => {
		syncStore.lastError =
			'Synced, but some photos could not be prepared for upload. They will retry on the next sync.';
		relayAnswers(async () => ({ success: true, snapshot: syncSnapshot() }));

		expect(await syncScheduler.request(syncStore.activeId)).toBe(true);
		expect(syncStore.lastError).toBeNull();
	});
});
