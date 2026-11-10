import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { releaseProfile, resumeProfile, waitForDeviceWrites } from '#lib/db/idb.js';
import { composerStore } from './composer.svelte';
import { notesStore } from './notes.svelte';
import { syncStore } from './sync.svelte';

const PID = 'abandoned-draft';
const DRAFT_KEY = 'scrapscache-composer-draft';

describe('the bar’s draft after its window went away', () => {
	beforeEach(() => {
		localStorage.clear();
		const account = createSyncIdentity();
		const profile = { id: PID, name: 'Draft', syncKey: account.syncKey, createdAt: 1 };
		syncStore.profiles = [profile];
		syncStore.activateProfile(profile);
		notesStore.notes = [];
		notesStore.labels = [];
		notesStore.lastPersistError = null;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		resumeProfile(PID);
		const internals = notesStore as unknown as {
			dirty: boolean;
			syncPushTimer: ReturnType<typeof setTimeout> | null;
		};
		if (internals.syncPushTimer) clearTimeout(internals.syncPushTimer);
		internals.syncPushTimer = null;
		internals.dirty = false;
		composerStore.draftId = null;
		syncStore.account = null;
		syncStore.profiles = [];
		notesStore.notes = [];
		notesStore.loaded = false;
	});

	it('is dropped at the next load when it stayed empty, kept when words reached it, and left to its own workspace otherwise', async () => {
		const empty = notesStore.createNote({ title: '', body: '' });
		const written = notesStore.createNote({ title: '', body: '' });
		notesStore.updateNote(written.id, { body: 'Milk' });
		await notesStore.flushNote(empty.id);
		await notesStore.flushNote(written.id);
		await waitForDeviceWrites(PID);

		// The window was killed with the label picker's draft open: nothing typed.
		localStorage.setItem(DRAFT_KEY, empty.id);
		await notesStore.init();
		expect(notesStore.notes.some((n) => n.id === empty.id)).toBe(false);
		expect(localStorage.getItem(DRAFT_KEY)).toBeNull();

		// Words were written before the window went: the note is a note.
		localStorage.setItem(DRAFT_KEY, written.id);
		await notesStore.init();
		expect(notesStore.notes.find((n) => n.id === written.id)?.body).toBe('Milk');
		expect(localStorage.getItem(DRAFT_KEY)).toBeNull();

		// A draft of another workspace waits for that workspace's load.
		localStorage.setItem(DRAFT_KEY, 'elsewhere');
		await notesStore.init();
		expect(localStorage.getItem(DRAFT_KEY)).toBe('elsewhere');
	});

	it('records, rather than throws, when the workspace went away under an empty note being dropped', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const note = notesStore.createNote({ title: '', body: '' });
		await notesStore.flushNote(note.id);
		await waitForDeviceWrites(PID);
		notesStore.lastPersistError = null;
		releaseProfile(PID);
		await expect(notesStore.discardIfEmpty(note.id)).resolves.toBeUndefined();
		expect(notesStore.lastPersistError).toMatch(/drop an empty note/);
	});
});
