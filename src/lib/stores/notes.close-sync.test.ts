import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/imageThumb.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/imageThumb.js')>();
	return { ...actual, makeImageThumbDataUrl: vi.fn(async () => null) };
});

import {
	clearAllNotes,
	clearSyncOutbox,
	getSyncOutboxKeys,
	markSyncOutbox,
	putNote
} from '#lib/db/idb.js';
import * as idb from '#lib/db/idb.js';
import { syncStore } from './sync.svelte';
import { syncSnapshot } from '#lib/syncRecords.js';
import { notesStore } from './notes.svelte';
import { syncScheduler } from './syncScheduler';
import type { Note } from '#lib/types.js';
import { TEST_WORKSPACE } from '../../tests/workspace';

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
function relayAnswers(answer: () => ReturnType<typeof syncStore.sync>) {
	vi.spyOn(syncStore, 'needsCurrentStateBootstrap').mockResolvedValue(false);
	return vi.spyOn(syncStore, 'sync').mockImplementation(answer);
}

describe('syncing when a note closes', () => {
	beforeEach(async () => {
		await clearSyncOutbox(TEST_WORKSPACE, await getSyncOutboxKeys(TEST_WORKSPACE));
		syncStore.account = {
			syncKey: 'test-key',
			accountId: 'test-account',
			authPublicKey: 'test-secret',
			pairingCode: 'test-code'
		};
	});

	afterEach(async () => {
		vi.clearAllTimers();
		vi.useRealTimers();
		syncScheduler.reset();
		vi.restoreAllMocks();
		syncStore.account = null;
		syncStore.lastError = null;
		notesStore.notes = [];
		notesStore.loaded = true;
		(
			notesStore as unknown as { attachmentHydrationFailures: Set<string> }
		).attachmentHydrationFailures.clear();
		await clearAllNotes(TEST_WORKSPACE);
		await clearSyncOutbox(TEST_WORKSPACE, await getSyncOutboxKeys(TEST_WORKSPACE));
	});

	it('skips the cloud request when there are no pending records', async () => {
		const flush = vi.spyOn(notesStore, 'flushSync').mockResolvedValue(true);

		expect(await notesStore.syncPendingChanges()).toBe(false);
		expect(flush).not.toHaveBeenCalled();
	});

	it('flushes the debounce immediately when a record is pending', async () => {
		await markSyncOutbox(TEST_WORKSPACE, ['note:note-1']);
		const flush = vi.spyOn(notesStore, 'flushSync').mockResolvedValue(true);

		expect(await notesStore.syncPendingChanges()).toBe(true);
		expect(flush).toHaveBeenCalledOnce();
	});

	it('asks the cloud request to spin the icon', async () => {
		await markSyncOutbox(TEST_WORKSPACE, ['note:note-1']);
		vi.spyOn(syncStore, 'needsCurrentStateBootstrap').mockResolvedValue(false);
		const sync = vi.spyOn(syncStore, 'sync').mockResolvedValue({
			success: true,
			snapshot: syncSnapshot()
		});

		expect(await notesStore.syncPendingChanges()).toBe(true);
		expect(sync.mock.calls[0]?.[1]).toBe(true);
	});

	it('manual sync takes the place of the sync waiting for changes to pause', async () => {
		await markSyncOutbox(TEST_WORKSPACE, ['note:note-1']);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const sync = relayAnswers(async () => {
			await clearSyncOutbox(TEST_WORKSPACE, ['note:note-1']);
			return { success: true, snapshot: syncSnapshot() };
		});
		syncScheduler.changed(TEST_WORKSPACE);

		expect(await notesStore.syncWithCloudManual()).toBe(true);
		await vi.advanceTimersByTimeAsync(10_000);

		expect(sync).toHaveBeenCalledOnce();
		expect(sync.mock.calls[0]?.[1]).toBe(true);
	});

	it('does not count a photo this device holds no bytes for as a failed upload', async () => {
		// Nothing of it is here to read, so nothing here failed; a sync settles it.
		const note = noteWithPhoto('');
		await putNote(TEST_WORKSPACE, note);
		notesStore.notes = [note];
		notesStore.lastPersistError = null;
		vi.spyOn(syncStore, 'sync').mockResolvedValue({ success: true, snapshot: syncSnapshot() });

		// Its card scrolls into view, then the next sync runs.
		await notesStore.ensureNoteAttachments(note.id);
		const synced = await (
			notesStore as unknown as { doSyncLocked(indicate: boolean): Promise<string> }
		).doSyncLocked(false);

		expect(synced).toBe('synced');
		expect(syncStore.lastError).toBeNull();
		expect(notesStore.lastPersistError).toBeNull();
	});

	it('warns after a sync while a photo on this device cannot be read', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const note = noteWithPhoto('');
		await putNote(TEST_WORKSPACE, note);
		notesStore.notes = [note];
		vi.spyOn(idb, 'hydrateNoteAttachments').mockRejectedValue(new Error('read failed'));
		vi.spyOn(syncStore, 'sync').mockResolvedValue({ success: true, snapshot: syncSnapshot() });

		await notesStore.ensureNoteAttachments(note.id);
		const synced = await (
			notesStore as unknown as { doSyncLocked(indicate: boolean): Promise<string> }
		).doSyncLocked(false);

		expect(synced).toBe('synced');
		expect(syncStore.lastError).toBe(
			'Synced, but some photos could not be prepared for upload. They will retry on the next sync.'
		);
	});

	it('does not replace the cloud copy while a listed photo is not on this device', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const note = noteWithPhoto('');
		await putNote(TEST_WORKSPACE, note);
		notesStore.notes = [note];
		const reauthenticate = vi.spyOn(syncStore, 'reauthenticateForRecovery').mockResolvedValue();
		const sync = vi.spyOn(syncStore, 'sync');

		expect(await notesStore.forcePushWorkspace()).toBe(false);
		expect(reauthenticate).not.toHaveBeenCalled();
		expect(sync).not.toHaveBeenCalled();
		expect(notesStore.lastPersistError).toMatch(/Replacing the cloud copy was not started/);
	});

	it('goes on to replace the cloud copy once every listed photo is read from this device', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await putNote(TEST_WORKSPACE, noteWithPhoto('data:image/png;base64,iVBORw0KGgo='));
		// Memory holds the note without its bytes, as after any durable write.
		notesStore.notes = [noteWithPhoto('')];
		const reauthenticate = vi
			.spyOn(syncStore, 'reauthenticateForRecovery')
			.mockRejectedValue(new Error('stop here'));

		expect(await notesStore.forcePushWorkspace()).toBe(false);
		expect(reauthenticate).toHaveBeenCalledOnce();
	});

	it('prunes attachment hydration failures after the damaged note is removed', async () => {
		const failures = (notesStore as unknown as { attachmentHydrationFailures: Set<string> })
			.attachmentHydrationFailures;
		failures.add('deleted-photo-note');
		notesStore.notes = [];
		notesStore.loaded = true;

		await (
			notesStore as unknown as { hydrateAttachmentsForSync(): Promise<void> }
		).hydrateAttachmentsForSync();

		expect(failures.size).toBe(0);
	});

	it('retries a failed attachment hydration without requiring an outbox marker', async () => {
		const note = noteWithPhoto('');
		notesStore.notes = [note];
		(
			notesStore as unknown as { attachmentHydrationFailures: Set<string> }
		).attachmentHydrationFailures.add(note.id);
		const hydrate = vi.spyOn(notesStore, 'ensureNoteAttachments').mockResolvedValue();

		await (
			notesStore as unknown as { hydrateAttachmentsForSync(): Promise<void> }
		).hydrateAttachmentsForSync();

		expect(hydrate).toHaveBeenCalledWith(note.id);
	});

	it('does not go again by itself for what a sync that settled left queued', async () => {
		notesStore.notes = [noteWithPhoto('')];
		(
			notesStore as unknown as { attachmentHydrationFailures: Set<string> }
		).attachmentHydrationFailures.add('photo-note');
		await markSyncOutbox(TEST_WORKSPACE, ['attachment:photo-1']);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const sync = relayAnswers(async () => ({ success: true, snapshot: syncSnapshot() }));

		expect(await notesStore.flushSync()).toBe(true);
		await vi.advanceTimersByTimeAsync(10 * 60_000);

		expect(sync).toHaveBeenCalledOnce();
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(['attachment:photo-1']);
	});

	it('tries again by itself, later each time, while the relay cannot be reached', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await markSyncOutbox(TEST_WORKSPACE, ['note:note-1']);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const sync = relayAnswers(async () => ({ success: false, error: 'Sync network error' }));

		expect(await notesStore.flushSync()).toBe(false);
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

		expect(await notesStore.flushSync()).toBe(false);
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

		expect(await notesStore.flushSync()).toBe(false);
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
		await notesStore.flushSync();
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
		syncStore.account = {
			accountId: 'acc-1',
			syncKey: 'key-1',
			authPublicKey: 'pub-1',
			pairingCode: 'CODE-1234'
		};
		syncStore.lastError =
			'Synced, but some photos could not be prepared for upload. They will retry on the next sync.';
		vi.spyOn(syncStore, 'sync').mockResolvedValue({ success: true, snapshot: syncSnapshot() });
		(
			notesStore as unknown as { attachmentHydrationFailures: Set<string> }
		).attachmentHydrationFailures.clear();

		const synced = await (
			notesStore as unknown as { doSyncLocked(indicate: boolean): Promise<string> }
		).doSyncLocked(false);

		expect(synced).toBe('synced');
		expect(syncStore.lastError).toBeNull();
	});
});
