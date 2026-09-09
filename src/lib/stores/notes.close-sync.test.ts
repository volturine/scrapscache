import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearAllNotes,
	clearSyncOutbox,
	getSyncOutboxKeys,
	markSyncOutbox,
	putNote,
	LOCAL_PROFILE_ID
} from '$lib/db/idb';
import { syncStore } from './sync.svelte';
import { notesStore } from './notes.svelte';
import type { Note } from '$lib/types';

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

describe('syncing when a note closes', () => {
	beforeEach(async () => {
		await clearSyncOutbox(LOCAL_PROFILE_ID, await getSyncOutboxKeys());
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
		const internals = notesStore as unknown as {
			dirty: boolean;
			syncPushTimer: ReturnType<typeof setTimeout> | null;
		};
		if (internals.syncPushTimer) clearTimeout(internals.syncPushTimer);
		internals.syncPushTimer = null;
		internals.dirty = false;
		vi.restoreAllMocks();
		syncStore.account = null;
		syncStore.lastError = null;
		notesStore.notes = [];
		(
			notesStore as unknown as { attachmentHydrationFailures: Set<string> }
		).attachmentHydrationFailures.clear();
		await clearAllNotes();
		await clearSyncOutbox(LOCAL_PROFILE_ID, await getSyncOutboxKeys());
	});

	it('skips the cloud request when there are no pending records', async () => {
		const flush = vi.spyOn(notesStore, 'flushSync').mockResolvedValue(true);

		expect(await notesStore.syncPendingChanges()).toBe(false);
		expect(flush).not.toHaveBeenCalled();
	});

	it('flushes the debounce immediately when a record is pending', async () => {
		await markSyncOutbox(['note:note-1']);
		const flush = vi.spyOn(notesStore, 'flushSync').mockResolvedValue(true);

		expect(await notesStore.syncPendingChanges()).toBe(true);
		expect(flush).toHaveBeenCalledOnce();
		expect(flush).toHaveBeenCalledWith(true);
	});

	it('asks the cloud request to spin the icon', async () => {
		await markSyncOutbox(['note:note-1']);
		vi.spyOn(syncStore, 'needsCurrentStateBootstrap').mockResolvedValue(false);
		const sync = vi.spyOn(syncStore, 'sync').mockResolvedValue({
			success: true,
			notes: [],
			labels: []
		});

		expect(await notesStore.syncPendingChanges()).toBe(true);
		expect(sync.mock.calls[0]?.[6]).toBe(true);
	});

	it('manual sync cancels the pending automatic pass and settles dirty state', async () => {
		await markSyncOutbox(['note:note-1']);
		(notesStore as unknown as { dirty: boolean }).dirty = true;
		(notesStore as unknown as { scheduleSyncPush(): void }).scheduleSyncPush();
		vi.spyOn(
			notesStore as unknown as { queueSync(indicate: boolean): Promise<boolean> },
			'queueSync'
		).mockImplementation(async (indicate) => {
			expect(indicate).toBe(true);
			await clearSyncOutbox(LOCAL_PROFILE_ID, ['note:note-1']);
			return true;
		});

		expect(await notesStore.syncWithCloudManual()).toBe(true);
		expect((notesStore as unknown as { dirty: boolean }).dirty).toBe(false);
		expect(
			(notesStore as unknown as { syncPushTimer: ReturnType<typeof setTimeout> | null })
				.syncPushTimer
		).toBeNull();
	});

	it('treats attachment metadata without its IndexedDB blob as a hydration failure', async () => {
		const note = noteWithPhoto('');
		await putNote(note);
		notesStore.notes = [note];

		await notesStore.ensureNoteAttachments(note.id);

		const failures = (notesStore as unknown as { attachmentHydrationFailures: Set<string> })
			.attachmentHydrationFailures;
		expect(failures.has(note.id)).toBe(true);
		expect(notesStore.lastPersistError).toMatch(/missing from device storage/i);
	});

	it('prunes attachment hydration failures after the damaged note is removed', async () => {
		const failures = (notesStore as unknown as { attachmentHydrationFailures: Set<string> })
			.attachmentHydrationFailures;
		failures.add('deleted-photo-note');
		notesStore.notes = [];

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

	it('keeps dirty flag on partial sync without background timer polling', async () => {
		notesStore.notes = [noteWithPhoto('')];
		(
			notesStore as unknown as { attachmentHydrationFailures: Set<string> }
		).attachmentHydrationFailures.add('photo-note');
		await markSyncOutbox(['attachment:photo-1']);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		(notesStore as unknown as { dirty: boolean }).dirty = true;
		const queue = vi.spyOn(
			notesStore as unknown as { queueSync(indicate: boolean): Promise<boolean> },
			'queueSync'
		);
		queue.mockResolvedValueOnce(true);

		expect(await notesStore.flushSync()).toBe(true);
		expect((notesStore as unknown as { dirty: boolean }).dirty).toBe(true);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(queue).toHaveBeenCalledTimes(1);
	});

	it('keeps dirty flag on relay failure without background timer polling', async () => {
		await markSyncOutbox(['note:note-1']);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		(notesStore as unknown as { dirty: boolean }).dirty = true;
		const queue = vi.spyOn(
			notesStore as unknown as { queueSync(indicate: boolean): Promise<boolean> },
			'queueSync'
		);
		queue.mockResolvedValueOnce(false);

		expect(await notesStore.flushSync()).toBe(false);
		expect((notesStore as unknown as { dirty: boolean }).dirty).toBe(true);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(queue).toHaveBeenCalledTimes(1);
	});

	it('does not automatically retry a quota failure', async () => {
		await markSyncOutbox(['note:note-1']);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		(notesStore as unknown as { dirty: boolean }).dirty = true;
		syncStore.lastError = 'Sync account storage quota exceeded';
		const queue = vi
			.spyOn(
				notesStore as unknown as { queueSync(indicate: boolean): Promise<boolean> },
				'queueSync'
			)
			.mockResolvedValue(false);

		expect(await notesStore.flushSync()).toBe(false);
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(queue).toHaveBeenCalledOnce();
	});

	it('retries dirty sync immediately when the browser comes online', async () => {
		await markSyncOutbox(['note:note-1']);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		(notesStore as unknown as { dirty: boolean }).dirty = true;
		const queue = vi
			.spyOn(
				notesStore as unknown as { queueSync(indicate: boolean): Promise<boolean> },
				'queueSync'
			)
			.mockResolvedValueOnce(false)
			.mockImplementationOnce(async () => {
				await clearSyncOutbox(LOCAL_PROFILE_ID, ['note:note-1']);
				return true;
			});
		await notesStore.flushSync();

		window.dispatchEvent(new Event('online'));
		await vi.advanceTimersByTimeAsync(0);
		await settleIndexedDb();

		expect(queue).toHaveBeenCalledTimes(2);
		expect((notesStore as unknown as { dirty: boolean }).dirty).toBe(false);
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
		vi.spyOn(syncStore, 'sync').mockResolvedValue({
			success: true,
			notes: [],
			labels: [],
			boards: []
		});
		(
			notesStore as unknown as { attachmentHydrationFailures: Set<string> }
		).attachmentHydrationFailures.clear();

		const synced = await (
			notesStore as unknown as { doSyncLocked(indicate: boolean): Promise<boolean> }
		).doSyncLocked(false);

		expect(synced).toBe(true);
		expect(syncStore.lastError).toBeNull();
	});
});
