import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import {
	closeDeviceDatabase,
	dropDatabase,
	getAllNotesMetadata,
	getSyncOutboxKeys,
	isProfileReleased,
	LOCAL_PROFILE_ID,
	putNote,
	resolveDbName,
	scopedStateKey
} from '$lib/db/idb';
import { readNotesMirror, writeNotesMirror } from '$lib/noteStorage';
import { readProfiles, saveProfile, type StoredProfile } from '$lib/profiles';
import { createSyncIdentity } from '$lib/syncPairing';
import type { Note } from '$lib/types';
import { unregisterReminderDevice } from '$lib/reminderWake';
import { ProfileCoordinator, profileCoordinator } from './profiles.svelte';
import { notesStore, SYNC_LOCK } from './notes.svelte';
import { PROFILE_META_KEY, syncStore } from './sync.svelte';

vi.mock('$lib/reminderWake', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/reminderWake')>();
	return { ...actual, unregisterReminderDevice: vi.fn().mockResolvedValue(undefined) };
});

function note(id: string): Note {
	return {
		id,
		title: 'Keep me',
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
		images: []
	};
}

function workspace(id: string, synced: boolean, createdAt = 1): StoredProfile {
	return { id, name: id, syncKey: synced ? createSyncIdentity().syncKey : '', createdAt };
}

async function noteIds(pid: string): Promise<string[]> {
	return (await getAllNotesMetadata(pid)).map(({ id }) => id);
}

/** Web Locks as the browser grants them: one holder at a time, in request order. */
function serialLocks() {
	let chain: Promise<unknown> = Promise.resolve();
	return {
		request: <T>(_name: string, run: () => Promise<T>): Promise<T> => {
			const held = chain.then(run);
			chain = held.catch(() => undefined);
			return held;
		}
	};
}

async function databaseNames(): Promise<string[]> {
	const databases = await indexedDB.databases();
	return databases.map((entry) => entry.name).filter((name): name is string => !!name);
}

function stubHandover() {
	vi.spyOn(notesStore, 'waitForPendingProfileWrites').mockResolvedValue();
	vi.spyOn(syncStore, 'queueOutbox').mockResolvedValue();
	return vi.spyOn(notesStore, 'reloadForProfile').mockResolvedValue();
}

describe('workspace handovers', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		syncStore.activateLocalWorkspace();
		syncStore.profiles = [];
		notesStore.notes = [];
		notesStore.labels = [];
		localStorage.clear();
	});

	it('starts syncing the active workspace in place', async () => {
		const local = workspace(LOCAL_PROFILE_ID, false, 0);
		syncStore.profiles = [local, workspace('other', false, 2)];
		syncStore.activateProfile(local);
		await putNote(local.id, note('local-note'));
		stubHandover();
		const sync = vi.spyOn(notesStore, 'syncWithCloudManual').mockReturnValue(new Promise(() => {}));
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

		const result = await new ProfileCoordinator().startSync(local.id, 'Field notes');

		expect(result).toEqual({ success: true });
		expect(syncStore.profiles.map(({ id }) => id)).toEqual([LOCAL_PROFILE_ID, 'other']);
		expect(syncStore.activeProfile?.id).toBe(LOCAL_PROFILE_ID);
		expect(syncStore.activeProfile?.name).toBe('Field notes');
		expect(syncStore.activeProfile?.syncKey).toBe(syncStore.account?.syncKey);
		expect(readProfiles().find(({ id }) => id === LOCAL_PROFILE_ID)?.syncKey).toBe(
			syncStore.account?.syncKey
		);
		expect(sync).toHaveBeenCalledOnce();
		expect(await noteIds(local.id)).toEqual(['local-note']);
	});

	it('moves a workspace with a retired key onto a new key in place', async () => {
		const retired = workspace('retired', true);
		syncStore.profiles = [retired];
		syncStore.activateProfile(retired);
		syncStore.keyRetired = true;
		await putNote(retired.id, note('kept-note'));
		const oldAccount = syncStore.account!.accountId;
		stubHandover();
		const sync = vi.spyOn(notesStore, 'syncWithCloudManual').mockReturnValue(new Promise(() => {}));
		const cleared = vi.spyOn(syncStore, 'clearAccountControlPlane');
		const register = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

		const result = await new ProfileCoordinator().replaceRetiredKey(retired.id, 'turnstile-token');

		expect(result).toEqual({ success: true });
		const [moved] = syncStore.profiles;
		expect(moved.id).toBe(retired.id);
		expect(moved.syncKey).not.toBe(retired.syncKey);
		expect(syncStore.account?.syncKey).toBe(moved.syncKey);
		expect(syncStore.keyRetired).toBe(false);
		expect(readProfiles()[0].syncKey).toBe(moved.syncKey);
		expect(JSON.parse(String(register.mock.calls[0][1]?.body)).turnstileToken).toBe(
			'turnstile-token'
		);
		expect(cleared).toHaveBeenCalledWith(oldAccount, retired.id);
		expect(sync).toHaveBeenCalledOnce();
		expect(await noteIds(retired.id)).toEqual(['kept-note']);
	});

	it('keeps a retired key when the new one cannot be registered', async () => {
		const retired = workspace('retired-failing', true);
		syncStore.profiles = [retired];
		syncStore.activateProfile(retired);
		stubHandover();
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			Response.json({ error: 'Human verification failed. Try again.' }, { status: 403 })
		);

		const result = await new ProfileCoordinator().replaceRetiredKey(retired.id);

		expect(result).toEqual({ success: false, error: 'Human verification failed. Try again.' });
		expect(syncStore.profiles).toEqual([retired]);
	});

	it('starts syncing an inactive workspace without leaving the current one', async () => {
		const current = workspace('current', false);
		const other = workspace('inactive-promote', false, 2);
		syncStore.profiles = [current, other];
		syncStore.activateProfile(current);
		stubHandover();
		const sync = vi.spyOn(notesStore, 'syncWithCloudManual');
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

		const result = await new ProfileCoordinator().startSync(other.id);

		expect(result).toEqual({ success: true });
		expect(syncStore.activeId).toBe(current.id);
		expect(syncStore.account).toBeNull();
		expect(syncStore.profiles.find(({ id }) => id === other.id)?.syncKey).not.toBe('');
		expect(await getSyncOutboxKeys(other.id)).toContain(PROFILE_META_KEY);
		expect(sync).not.toHaveBeenCalled();
	});

	it('unlinks the active workspace into a private one that keeps its notes', async () => {
		const active = workspace(LOCAL_PROFILE_ID, true, 0);
		syncStore.profiles = [active];
		syncStore.activateProfile(active);
		await putNote(active.id, note('synced-note'));
		const reload = stubHandover();
		const deleteCloud = vi.spyOn(syncStore, 'deleteCloudAccount');

		const result = await new ProfileCoordinator().unlink(active.id);

		expect(result).toEqual({ success: true });
		expect(deleteCloud).not.toHaveBeenCalled();
		expect(unregisterReminderDevice).toHaveBeenCalled();
		expect(syncStore.account).toBeNull();
		expect(syncStore.profiles).toEqual([{ ...active, syncKey: '' }]);
		expect(syncStore.activeId).toBe(active.id);
		expect(reload).toHaveBeenCalledOnce();
		expect(await noteIds(active.id)).toEqual(['synced-note']);
	});

	it('unlinks an inactive workspace without touching the current one', async () => {
		const current = workspace('current-unlink', true);
		const other = workspace('inactive-unlink', true, 2);
		syncStore.profiles = [current, other];
		syncStore.activateProfile(current);
		await putNote(other.id, note('other-note'));
		const reload = stubHandover();

		const result = await new ProfileCoordinator().unlink(other.id);

		expect(result).toEqual({ success: true });
		expect(syncStore.activeProfile).toEqual(current);
		expect(syncStore.profiles[1]).toEqual({ ...other, syncKey: '' });
		expect(reload).not.toHaveBeenCalled();
		expect(await noteIds(other.id)).toEqual(['other-note']);
	});

	it('deletes cloud data and keeps the notes as a private workspace', async () => {
		const active = workspace('delete-cloud', true);
		syncStore.profiles = [active];
		syncStore.activateProfile(active);
		await putNote(active.id, note('kept-note'));
		stubHandover();
		const request = vi
			.spyOn(syncStore, 'authorizedFetch')
			.mockResolvedValue(new Response(null, { status: 204 }));

		const result = await new ProfileCoordinator().unlink(active.id, true);

		expect(result).toEqual({ success: true });
		expect(request).toHaveBeenCalledWith(
			'/api/sync/account',
			{ method: 'DELETE' },
			expect.objectContaining({ syncKey: active.syncKey })
		);
		expect(syncStore.profiles).toEqual([{ ...active, syncKey: '' }]);
		expect(syncStore.account).toBeNull();
		expect(await noteIds(active.id)).toEqual(['kept-note']);
	});

	it('keeps the workspace synced when cloud deletion fails', async () => {
		const active = workspace('delete-cloud-fails', true);
		syncStore.profiles = [active];
		syncStore.activateProfile(active);
		stubHandover();
		vi.spyOn(syncStore, 'authorizedFetch').mockResolvedValue(
			Response.json({ error: 'Relay unavailable' }, { status: 503 })
		);

		const result = await new ProfileCoordinator().unlink(active.id, true);

		expect(result).toEqual({ success: false, error: 'Relay unavailable' });
		expect(syncStore.profiles).toEqual([active]);
		expect(syncStore.account?.syncKey).toBe(active.syncKey);
	});

	it.each([
		['the default private', LOCAL_PROFILE_ID, false],
		['a synced', 'synced-remove', true]
	])('deletes %s workspace like any other', async (_label, id, synced) => {
		const target = workspace(id, synced, 0);
		const other = workspace('remaining', false, 2);
		syncStore.profiles = [target, other];
		syncStore.activateProfile(target);
		await putNote(target.id, note('removed-note'));
		await putNote(other.id, note('remaining-note'));
		const cached = [
			'scrapscache-notes-mirror',
			'scrapscache-labels-mirror',
			'scrapscache-kanban-boards-v1',
			'scrapscache-kanban-active-board-v1',
			'scrapscache-kanban-board-tombstones-v1',
			'scrapscache-fired-reminders-mirror',
			'scrapscache-sync-status'
		];
		for (const base of cached) {
			const key =
				base === 'scrapscache-sync-status'
					? `${base}:${target.id}`
					: scopedStateKey(base, target.id);
			localStorage.setItem(key, '["removed"]');
			localStorage.setItem(`${base}:${other.id}`, '["kept"]');
		}
		const reload = stubHandover();

		const result = await new ProfileCoordinator().remove(target.id);

		expect(result).toEqual({ success: true });
		expect(syncStore.profiles).toEqual([other]);
		expect(syncStore.activeId).toBe(other.id);
		expect(syncStore.account).toBeNull();
		expect(reload).toHaveBeenCalledOnce();
		// The default workspace is emptied inside the device database it shares;
		// any other is dropped, and this window never opens it again.
		if (target.id === LOCAL_PROFILE_ID) expect(await noteIds(target.id)).toEqual([]);
		else expect(await databaseNames()).not.toContain(resolveDbName(target.id));
		expect(await noteIds(other.id)).toEqual(['remaining-note']);
		// Nothing of the deleted workspace stays behind in this device's caches.
		const statusKey = `scrapscache-sync-status:${target.id}`;
		for (const base of cached) {
			const key = base === 'scrapscache-sync-status' ? statusKey : scopedStateKey(base, target.id);
			expect(localStorage.getItem(key), key).toBeNull();
			expect(localStorage.getItem(`${base}:${other.id}`), base).not.toBeNull();
		}
	});

	it('leaves a fresh empty workspace when the last one is deleted', async () => {
		const only = workspace(LOCAL_PROFILE_ID, false, 0);
		syncStore.profiles = [only];
		syncStore.activateProfile(only);
		await putNote(only.id, note('last-note'));
		stubHandover();

		const result = await new ProfileCoordinator().remove(only.id);

		expect(result).toEqual({ success: true });
		expect(syncStore.profiles).toHaveLength(1);
		expect(syncStore.profiles[0].id).not.toBe(LOCAL_PROFILE_ID);
		expect(syncStore.activeId).toBe(syncStore.profiles[0].id);
		expect(await noteIds(LOCAL_PROFILE_ID)).toEqual([]);
	});

	it('creates an empty private workspace without registering', async () => {
		const current = workspace(LOCAL_PROFILE_ID, false, 0);
		syncStore.profiles = [current];
		syncStore.activateProfile(current);
		await putNote(current.id, note('stay'));
		const reload = stubHandover();
		const register = vi.spyOn(syncStore, 'register');

		const result = await new ProfileCoordinator().createLocal();

		expect(result).toEqual({ success: true });
		expect(register).not.toHaveBeenCalled();
		expect(syncStore.profiles).toHaveLength(2);
		expect(syncStore.activeProfile?.syncKey).toBe('');
		expect(syncStore.activeId).not.toBe(LOCAL_PROFILE_ID);
		expect(reload).toHaveBeenCalledOnce();
		expect(await noteIds(LOCAL_PROFILE_ID)).toEqual(['stay']);
		expect(await noteIds(syncStore.activeId)).toEqual([]);
	});

	it('switches between private and synced workspaces without changing either', async () => {
		const synced = workspace('switch-synced', true);
		const local = workspace(LOCAL_PROFILE_ID, false, 0);
		syncStore.profiles = [local, synced];
		syncStore.activateProfile(synced);
		const reload = stubHandover();
		const sync = vi.spyOn(notesStore, 'syncWithCloudManual').mockResolvedValue(true);

		expect(await new ProfileCoordinator().switchTo(local.id)).toEqual({ success: true });
		expect(syncStore.activeId).toBe(local.id);
		expect(syncStore.account).toBeNull();
		expect(sync).not.toHaveBeenCalled();

		expect(await new ProfileCoordinator().switchTo(synced.id)).toEqual({ success: true });
		expect(syncStore.activeProfile).toEqual(synced);
		expect(syncStore.account?.syncKey).toBe(synced.syncKey);
		expect(sync).toHaveBeenCalledOnce();
		expect(reload).toHaveBeenCalledTimes(2);
		expect(syncStore.profiles).toEqual([local, synced]);
	});

	it('force pushes the active synced workspace', async () => {
		const active = workspace(LOCAL_PROFILE_ID, true, 0);
		syncStore.profiles = [active];
		syncStore.activateProfile(active);
		stubHandover();
		const push = vi.spyOn(notesStore, 'forcePushWorkspace').mockResolvedValue(true);

		const result = await new ProfileCoordinator().forceResync(undefined, active.id);

		expect(result).toEqual({ success: true });
		expect(push).toHaveBeenCalledOnce();
		expect(syncStore.activeProfile).toEqual(active);
	});

	it('activates another synced workspace before force pushing it', async () => {
		const active = workspace('active-force', true);
		const other = workspace('other-force', true, 2);
		syncStore.profiles = [active, other];
		syncStore.activateProfile(active);
		stubHandover();
		const push = vi.spyOn(notesStore, 'forcePushWorkspace').mockResolvedValue(true);

		const result = await new ProfileCoordinator().forceResync(undefined, other.id);

		expect(result).toEqual({ success: true });
		expect(syncStore.activeProfile).toEqual(other);
		expect(push).toHaveBeenCalledOnce();
	});

	it('rejects changes to an unknown workspace', async () => {
		const kept = workspace('kept', true);
		syncStore.profiles = [kept];
		stubHandover();

		for (const run of [
			(c: ProfileCoordinator) => c.unlink('missing'),
			(c: ProfileCoordinator) => c.remove('missing'),
			(c: ProfileCoordinator) => c.switchTo('missing'),
			(c: ProfileCoordinator) => c.startSync('missing')
		]) {
			expect(await run(new ProfileCoordinator())).toEqual({
				success: false,
				error: 'That workspace is no longer on this device'
			});
		}
		expect(syncStore.profiles).toEqual([kept]);
	});

	it.each([true, false])(
		'releases the handover lock before pulling a new paired workspace (sync succeeds: %s)',
		async (success) => {
			let held = false;
			vi.stubGlobal('navigator', {
				locks: {
					request: async (name: string, run: () => Promise<unknown>) => {
						expect(name).toBe(SYNC_LOCK);
						if (held) throw new Error('Nested sync lock would deadlock');
						held = true;
						try {
							return await run();
						} finally {
							held = false;
						}
					}
				}
			});
			try {
				syncStore.activateLocalWorkspace();
				await putNote(LOCAL_PROFILE_ID, note('keep-local'));
				stubHandover();
				const coordinator = new ProfileCoordinator();
				const pull = vi.spyOn(notesStore, 'replaceWithCloudManual').mockImplementation(async () => {
					expect(coordinator.switching).toBe(true);
					return navigator.locks.request(SYNC_LOCK, async () => success);
				});
				const merge = vi.spyOn(notesStore, 'syncWithCloudManual').mockResolvedValue(true);
				syncStore.lastError = null;
				const result = await coordinator.receiveLinkedKey(createSyncIdentity().syncKey);
				expect(result).toEqual(
					success
						? { outcome: 'linked' }
						: { outcome: 'linked', error: 'Could not sync the received profile' }
				);
				expect(pull).toHaveBeenCalledOnce();
				expect(merge).not.toHaveBeenCalled();
				expect(coordinator.switching).toBe(false);
				expect(await getAllNotesMetadata(syncStore.activePid)).toEqual([]);
				expect(await noteIds(LOCAL_PROFILE_ID)).toContain('keep-local');
			} finally {
				vi.unstubAllGlobals();
			}
		}
	);
});

/**
 * Each window keeps its own workspace, so one can be removed while another
 * still has it open. That window has to hear about it: its dataset has left
 * the device, and the next write would build it back with no keyring entry
 * naming the result.
 */
describe('a workspace removed in another window', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		syncStore.activateLocalWorkspace();
		syncStore.profiles = [];
		notesStore.notes = [];
		notesStore.labels = [];
		localStorage.clear();
	});

	it('moves this window to another workspace without asking', async () => {
		const removed = workspace('removed-elsewhere', false, 1);
		const kept = workspace('kept-elsewhere', false, 2);
		syncStore.profiles = [removed, kept];
		syncStore.activateProfile(removed);
		await putNote(kept.id, note('kept-note'));
		const reload = stubHandover();
		// What the other window left behind: a keyring without the open workspace.
		localStorage.setItem('scrapscache-sync-profiles', JSON.stringify([kept]));

		await new ProfileCoordinator().adoptKeyring();

		expect(syncStore.activeId).toBe(kept.id);
		expect(syncStore.profiles).toEqual([kept]);
		expect(reload).toHaveBeenCalledOnce();
		// Nothing may reopen the removed namespace and rebuild it.
		expect(isProfileReleased(removed.id)).toBe(true);
		await expect(getAllNotesMetadata(removed.id)).rejects.toThrow(/no longer on this device/);
		expect(await noteIds(kept.id)).toEqual(['kept-note']);
	});

	it('leaves a fresh empty workspace when the one it had open was the last', async () => {
		const removed = workspace('only-elsewhere', false, 1);
		syncStore.profiles = [removed];
		syncStore.activateProfile(removed);
		stubHandover();
		localStorage.setItem('scrapscache-sync-profiles', JSON.stringify([]));

		await new ProfileCoordinator().adoptKeyring();

		expect(syncStore.profiles).toHaveLength(1);
		expect(syncStore.profiles[0].id).not.toBe(removed.id);
		expect(syncStore.activeId).toBe(syncStore.profiles[0].id);
	});

	it('adopts a workspace another window added without handing this one over', async () => {
		const open = workspace('open-elsewhere', false, 1);
		const added = workspace('added-elsewhere', false, 2);
		syncStore.profiles = [open];
		syncStore.activateProfile(open);
		const reload = stubHandover();
		localStorage.setItem('scrapscache-sync-profiles', JSON.stringify([open, added]));

		await new ProfileCoordinator().adoptKeyring();

		expect(syncStore.activeId).toBe(open.id);
		expect(syncStore.profiles.map((entry) => entry.id)).toEqual([open.id, added.id]);
		expect(reload).not.toHaveBeenCalled();
	});

	it('listens for the keyring and for nothing else', () => {
		const adopt = vi.spyOn(profileCoordinator, 'adoptKeyring').mockResolvedValue();

		window.dispatchEvent(new StorageEvent('storage', { key: 'scrapscache-notes-mirror' }));
		expect(adopt).not.toHaveBeenCalled();

		window.dispatchEvent(new StorageEvent('storage', { key: 'scrapscache-sync-profiles' }));
		// A null key is the whole origin being cleared, keyring included.
		window.dispatchEvent(new StorageEvent('storage', { key: null }));
		expect(adopt).toHaveBeenCalledTimes(2);
	});

	// The handover waits on the sync lock. Whatever happened to this window in the
	// meantime, it must not throw away a workspace the user has since picked.
	it('leaves alone a window that moved on while the handover waited', async () => {
		const removed = workspace('removed-while-waiting', false, 1);
		const kept = workspace('first-remaining', false, 2);
		const chosen = workspace('picked-meanwhile', false, 3);
		syncStore.profiles = [removed, kept, chosen];
		syncStore.activateProfile(removed);
		const reload = stubHandover();
		vi.stubGlobal('navigator', { ...navigator, locks: serialLocks() });
		try {
			let releaseSwitch!: () => void;
			const switchGate = new Promise<void>((resolve) => (releaseSwitch = resolve));
			// A switch the user started is holding the lock.
			const userSwitch = navigator.locks.request(SYNC_LOCK, async () => {
				await switchGate;
				syncStore.activateProfile(chosen);
			});
			localStorage.setItem('scrapscache-sync-profiles', JSON.stringify([kept, chosen]));
			const adopting = new ProfileCoordinator().adoptKeyring();

			releaseSwitch();
			await userSwitch;
			await adopting;

			expect(syncStore.activeId).toBe(chosen.id);
			expect(reload).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('hands over once when the keyring changes twice in a row', async () => {
		const removed = workspace('removed-twice', false, 1);
		const kept = workspace('kept-twice', false, 2);
		syncStore.profiles = [removed, kept];
		syncStore.activateProfile(removed);
		const reload = stubHandover();
		vi.stubGlobal('navigator', { ...navigator, locks: serialLocks() });
		try {
			localStorage.setItem('scrapscache-sync-profiles', JSON.stringify([kept]));
			const coordinator = new ProfileCoordinator();

			await Promise.all([coordinator.adoptKeyring(), coordinator.adoptKeyring()]);

			expect(syncStore.activeId).toBe(kept.id);
			expect(reload).toHaveBeenCalledOnce();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	// The keyring only changes once the delete lands, and a third window holding
	// the database open can put that off indefinitely. The delete itself cannot be
	// called off, so the moment it is asked for is the moment to leave.
	it('leaves a workspace as soon as another window starts deleting it', async () => {
		const deleting = workspace('deleting-elsewhere', false, 1);
		const kept = workspace('kept-while-deleting', false, 2);
		syncStore.profiles = [deleting, kept];
		syncStore.activateProfile(deleting);
		// Holds this window's connection open, as working in the workspace does.
		await putNote(deleting.id, note('open-here'));
		stubHandover();

		await dropDatabase(resolveDbName(deleting.id), 50);

		await vi.waitFor(() => expect(syncStore.activeId).toBe(kept.id));
		expect(isProfileReleased(deleting.id)).toBe(true);
		expect(await databaseNames()).not.toContain(resolveDbName(deleting.id));
	});

	it('clears the mirrors of a workspace whose delete another window is holding up, and lists it until the delete lands', async () => {
		const target = workspace('delete-held-up', false, 1);
		const other = workspace('stays-listed', false, 2);
		await saveProfile(target);
		await saveProfile(other);
		syncStore.profiles = [target, other];
		syncStore.activateProfile(other);
		await putNote(target.id, note('doomed'));
		writeNotesMirror([note('doomed')], target.id);
		await closeDeviceDatabase();
		// A window this one cannot ask to step aside: one on an older build.
		const holder = await openDB(resolveDbName(target.id));
		stubHandover();

		const result = await new ProfileCoordinator().remove(target.id);

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/still open somewhere else/);
		// Left behind, the mirror would bring these notes back without their
		// attachments once the delete lands and the workspace is opened again.
		expect(readNotesMirror(target.id)).toEqual([]);
		expect(syncStore.profiles.map((entry) => entry.id)).toContain(target.id);
		// Still listed, but not to be opened: an open would queue behind the
		// delete and then build an empty database back that nothing names.
		expect(await new ProfileCoordinator().switchTo(target.id)).toEqual({
			success: false,
			error: 'That workspace is no longer on this device'
		});
		expect(syncStore.activeId).toBe(other.id);

		holder.close();

		await vi.waitFor(() => expect(syncStore.profiles.map((entry) => entry.id)).toEqual([other.id]));
		expect(readProfiles().map((entry) => entry.id)).toEqual([other.id]);
		expect(await databaseNames()).not.toContain(resolveDbName(target.id));
	}, 10_000);
});
