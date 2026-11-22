import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import {
	closeDeviceDatabase,
	dropDatabase,
	getAllNotesMetadata,
	getSyncOutboxKeys,
	isProfileReleased,
	putNote,
	resolveDbName
} from '#lib/db/idb.js';
import { readNotesMirror, writeNotesMirror } from '#lib/noteStorage.js';
import { readProfiles, saveProfile, type StoredProfile } from '#lib/profiles.js';
import { createSyncIdentity, identityFromSyncKey } from '#lib/syncPairing.js';
import type { Note } from '#lib/types.js';
import { unregisterReminderDevice } from '#lib/reminderWake.js';
import { ProfileCoordinator, profileCoordinator } from './profiles.svelte';
import { notesStore } from './notes.svelte';
import { SYNC_LOCK, syncScheduler } from './syncScheduler';
import { PROFILE_META_KEY, syncStore } from './sync.svelte';
import { TEST_WORKSPACE } from '../../tests/workspace';
import { WORKSPACE_LOCK, withWorkspaceLock } from '#lib/webLock.js';

vi.mock('#lib/reminderWake.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/reminderWake.js')>();
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

function stubChange() {
	vi.spyOn(notesStore, 'waitForPendingProfileWrites').mockResolvedValue();
	vi.spyOn(syncStore, 'queueOutbox').mockResolvedValue();
	return vi.spyOn(notesStore, 'reloadForProfile').mockResolvedValue();
}

describe('workspace changes', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		syncStore.activateLocalWorkspace(TEST_WORKSPACE);
		syncStore.profiles = [];
		notesStore.notes = [];
		notesStore.labels = [];
		localStorage.clear();
	});

	it('starts syncing the active workspace in place', async () => {
		const local = workspace(TEST_WORKSPACE, false, 0);
		syncStore.profiles = [local, workspace('other', false, 2)];
		syncStore.activateProfile(local);
		await putNote(local.id, note('local-note'));
		stubChange();
		const sync = vi.spyOn(notesStore, 'syncWithCloudManual').mockReturnValue(new Promise(() => {}));
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

		const result = await new ProfileCoordinator().startSync(local.id, 'Field notes');

		expect(result).toEqual({ success: true });
		expect(syncStore.profiles.map(({ id }) => id)).toEqual([TEST_WORKSPACE, 'other']);
		expect(syncStore.activeProfile?.id).toBe(TEST_WORKSPACE);
		expect(syncStore.activeProfile?.name).toBe('Field notes');
		expect(syncStore.activeProfile?.syncKey).toBe(syncStore.account?.syncKey);
		expect(readProfiles().find(({ id }) => id === TEST_WORKSPACE)?.syncKey).toBe(
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
		stubChange();
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
		stubChange();
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
		stubChange();
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

	// Registering asks the relay, which can take as long as a poor connection does.
	// A workspace change, in this window or another, must not wait behind it.
	it('holds nothing while the relay registers a workspace that starts syncing', async () => {
		const current = workspace('current-registering', false);
		const other = workspace('other-registering', false, 2);
		syncStore.profiles = [current, other];
		syncStore.activateProfile(current);
		stubChange();
		let registered: (response: Response) => void = () => undefined;
		const fetched = vi
			.spyOn(globalThis, 'fetch')
			.mockReturnValue(new Promise<Response>((resolve) => (registered = resolve)));
		const coordinator = new ProfileCoordinator();

		const started = coordinator.startSync(other.id);
		await vi.waitFor(() => expect(fetched).toHaveBeenCalledOnce());

		expect(coordinator.switching).toBe(false);
		expect(await withWorkspaceLock(async () => 'another change')).toBe('another change');
		expect(await syncScheduler.rewrite(other.id, async () => 'a rewrite')).toBe('a rewrite');
		expect(syncStore.profiles.find(({ id }) => id === other.id)?.syncKey).toBe('');

		registered(Response.json({ ok: true }));
		expect(await started).toEqual({ success: true });
		expect(syncStore.profiles.find(({ id }) => id === other.id)?.syncKey).not.toBe('');
	});

	it('does not give a workspace a key when it changed while the relay registered it', async () => {
		const current = workspace('current-changed', false);
		const other = workspace('other-changed', false, 2);
		syncStore.profiles = [current, other];
		syncStore.activateProfile(current);
		stubChange();
		let registered: (response: Response) => void = () => undefined;
		const fetched = vi
			.spyOn(globalThis, 'fetch')
			.mockReturnValue(new Promise<Response>((resolve) => (registered = resolve)));

		const started = new ProfileCoordinator().startSync(other.id);
		await vi.waitFor(() => expect(fetched).toHaveBeenCalledOnce());
		// Another window gave it a key meanwhile.
		const theirs = { ...other, syncKey: createSyncIdentity().syncKey };
		syncStore.profiles = [current, theirs];
		registered(Response.json({ ok: true }));

		expect(await started).toEqual({
			success: false,
			error: 'This workspace changed meanwhile. Try again.'
		});
		expect(syncStore.profiles).toEqual([current, theirs]);
	});

	it('does not ask the relay to register a workspace that already syncs', async () => {
		const synced = workspace('already-synced', true);
		syncStore.profiles = [synced];
		syncStore.activateProfile(synced);
		const fetched = vi.spyOn(globalThis, 'fetch');

		expect(await new ProfileCoordinator().startSync(synced.id)).toEqual({
			success: false,
			error: 'That workspace is already synced'
		});
		expect(fetched).not.toHaveBeenCalled();
	});

	it('unlinks the active workspace into a private one that keeps its notes', async () => {
		const active = workspace(TEST_WORKSPACE, true, 0);
		syncStore.profiles = [active];
		syncStore.activateProfile(active);
		await putNote(active.id, note('synced-note'));
		const reload = stubChange();
		const deleteCloud = vi.spyOn(syncStore, 'deleteRelayAccount');

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
		const reload = stubChange();

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
		stubChange();
		const request = vi
			.spyOn(syncStore, 'authorizedFetch')
			.mockResolvedValue(new Response(null, { status: 204 }));

		const result = await new ProfileCoordinator().unlink(active.id, true);

		expect(result).toEqual({ success: true });
		expect(request).toHaveBeenCalledWith(
			'/api/sync/account',
			expect.objectContaining({
				method: 'DELETE',
				headers: { 'content-type': 'application/json' }
			}),
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
		stubChange();
		vi.spyOn(syncStore, 'authorizedFetch').mockResolvedValue(
			Response.json({ error: 'Relay unavailable' }, { status: 503 })
		);

		const result = await new ProfileCoordinator().unlink(active.id, true);

		expect(result).toEqual({ success: false, error: 'Relay unavailable' });
		expect(syncStore.profiles).toEqual([active]);
		expect(syncStore.account?.syncKey).toBe(active.syncKey);
	});

	it.each([
		['a private', 'private-remove', false],
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
			const key = `${base}:${target.id}`;
			localStorage.setItem(key, '["removed"]');
			localStorage.setItem(`${base}:${other.id}`, '["kept"]');
		}
		const reload = stubChange();

		const result = await new ProfileCoordinator().remove(target.id);

		expect(result).toEqual({ success: true });
		expect(syncStore.profiles).toEqual([other]);
		expect(syncStore.activeId).toBe(other.id);
		expect(syncStore.account).toBeNull();
		expect(reload).toHaveBeenCalledOnce();
		// Its database is dropped, and this window never opens it again.
		expect(await databaseNames()).not.toContain(resolveDbName(target.id));
		expect(await noteIds(other.id)).toEqual(['remaining-note']);
		// Nothing of the deleted workspace stays behind in this device's caches.
		const statusKey = `scrapscache-sync-status:${target.id}`;
		for (const base of cached) {
			const key = base === 'scrapscache-sync-status' ? statusKey : `${base}:${target.id}`;
			expect(localStorage.getItem(key), key).toBeNull();
			expect(localStorage.getItem(`${base}:${other.id}`), base).not.toBeNull();
		}
	});

	it('leaves a fresh empty workspace when the last one is deleted', async () => {
		const only = workspace(TEST_WORKSPACE, false, 0);
		syncStore.profiles = [only];
		syncStore.activateProfile(only);
		await putNote(only.id, note('last-note'));
		stubChange();

		const result = await new ProfileCoordinator().remove(only.id);

		expect(result).toEqual({ success: true });
		expect(syncStore.profiles).toHaveLength(1);
		expect(syncStore.profiles[0].id).not.toBe(TEST_WORKSPACE);
		expect(syncStore.activeId).toBe(syncStore.profiles[0].id);
		expect(await databaseNames()).not.toContain(resolveDbName(TEST_WORKSPACE));
	});

	it('creates an empty private workspace without registering', async () => {
		const current = workspace(TEST_WORKSPACE, false, 0);
		syncStore.profiles = [current];
		syncStore.activateProfile(current);
		await putNote(current.id, note('stay'));
		const reload = stubChange();
		const register = vi.spyOn(syncStore, 'registerAccount');

		const result = await new ProfileCoordinator().createLocal();

		expect(result).toEqual({ success: true });
		expect(register).not.toHaveBeenCalled();
		expect(syncStore.profiles).toHaveLength(2);
		expect(syncStore.activeProfile?.syncKey).toBe('');
		expect(syncStore.activeId).not.toBe(TEST_WORKSPACE);
		expect(reload).toHaveBeenCalledOnce();
		expect(await noteIds(TEST_WORKSPACE)).toEqual(['stay']);
		expect(await noteIds(syncStore.activeId)).toEqual([]);
	});

	it('switches between private and synced workspaces without changing either', async () => {
		const synced = workspace('switch-synced', true);
		const local = workspace(TEST_WORKSPACE, false, 0);
		syncStore.profiles = [local, synced];
		syncStore.activateProfile(synced);
		const reload = stubChange();
		const sync = vi.spyOn(notesStore, 'reconcileWithCloud').mockResolvedValue(true);

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

	it('finishes a switch without waiting for the arrived workspace to sync', async () => {
		const synced = workspace('switch-background-sync', true);
		const local = workspace(TEST_WORKSPACE, false, 0);
		syncStore.profiles = [local, synced];
		syncStore.activateProfile(local);
		stubChange();
		const sync = vi
			.spyOn(notesStore, 'reconcileWithCloud')
			.mockReturnValue(new Promise(() => undefined));

		expect(await new ProfileCoordinator().switchTo(synced.id)).toEqual({ success: true });
		expect(syncStore.activeId).toBe(synced.id);
		expect(sync).toHaveBeenCalledOnce();
	});

	it('force pushes the active synced workspace', async () => {
		const active = workspace(TEST_WORKSPACE, true, 0);
		syncStore.profiles = [active];
		syncStore.activateProfile(active);
		stubChange();
		const push = vi.spyOn(notesStore, 'forcePushWorkspace').mockResolvedValue({ success: true });

		const result = await new ProfileCoordinator().forceResync(undefined, active.id);

		expect(result).toEqual({ success: true });
		expect(push).toHaveBeenCalledExactlyOnceWith(active.id, undefined);
		expect(syncStore.activeProfile).toEqual(active);
	});

	it('force pushes another synced workspace without leaving the open one', async () => {
		const active = workspace('active-force', true);
		const other = workspace('other-force', true, 2);
		syncStore.profiles = [active, other];
		syncStore.activateProfile(active);
		stubChange();
		const push = vi.spyOn(notesStore, 'forcePushWorkspace').mockResolvedValue({ success: true });

		const result = await new ProfileCoordinator().forceResync('token', other.id);

		expect(result).toEqual({ success: true });
		expect(push).toHaveBeenCalledExactlyOnceWith(other.id, 'token');
		expect(syncStore.activeProfile).toEqual(active);
	});

	it('rejects changes to an unknown workspace', async () => {
		const kept = workspace('kept', true);
		syncStore.profiles = [kept];
		stubChange();

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

	it('opens the workspace a received key already has on this device, without adding another', async () => {
		const held = workspace('held', true, 2);
		syncStore.profiles = [workspace(TEST_WORKSPACE, false, 0), held];
		syncStore.activateLocalWorkspace(TEST_WORKSPACE);
		stubChange();
		const sync = vi.spyOn(syncScheduler, 'request').mockResolvedValue(true);

		expect(await new ProfileCoordinator().receiveLinkedKey(held.syncKey)).toEqual({
			outcome: 'linked'
		});

		expect(syncStore.profiles.map(({ id }) => id)).toEqual([TEST_WORKSPACE, 'held']);
		expect(sync).toHaveBeenCalledExactlyOnceWith('held');
		expect(syncStore.activeId).toBe('held');
	});

	it.each([true, false])(
		'syncs a newly paired workspace before a window opens it, with no lock held meanwhile (sync succeeds: %s)',
		async (success) => {
			const held = new Set<string>();
			vi.stubGlobal('navigator', {
				locks: {
					request: async (name: string, run: () => Promise<unknown>) => {
						expect(name === WORKSPACE_LOCK || name.startsWith(SYNC_LOCK)).toBe(true);
						if (held.size > 0) throw new Error(`${name} asked for while ${[...held]} is held`);
						held.add(name);
						try {
							return await run();
						} finally {
							held.delete(name);
						}
					}
				}
			});
			try {
				syncStore.activateLocalWorkspace(TEST_WORKSPACE);
				await putNote(TEST_WORKSPACE, note('keep-local'));
				stubChange();
				const coordinator = new ProfileCoordinator();
				const sync = vi.spyOn(syncScheduler, 'request').mockImplementation(async (pid) => {
					// The sync waits on the relay: no workspace change may wait behind it.
					expect(held.size).toBe(0);
					expect(coordinator.switching).toBe(true);
					// The workspace is on the device, and no window shows it yet.
					expect(syncStore.profiles.some((entry) => entry.id === pid)).toBe(true);
					expect(syncStore.activeId).toBe(TEST_WORKSPACE);
					return success;
				});
				const result = await coordinator.receiveLinkedKey(createSyncIdentity().syncKey);
				expect(result).toEqual(
					success
						? { outcome: 'linked' }
						: { outcome: 'linked', error: 'Could not sync the received profile' }
				);
				expect(sync).toHaveBeenCalledExactlyOnceWith(syncStore.activeId);
				expect(syncStore.activeId).not.toBe(TEST_WORKSPACE);
				expect(coordinator.switching).toBe(false);
				expect(await getAllNotesMetadata(syncStore.activePid)).toEqual([]);
				expect(await noteIds(TEST_WORKSPACE)).toContain('keep-local');
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
		syncStore.activateLocalWorkspace(TEST_WORKSPACE);
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
		const reload = stubChange();
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
		stubChange();
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
		const reload = stubChange();
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
		const reload = stubChange();
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
		const reload = stubChange();
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
		stubChange();

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
		stubChange();

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

/**
 * The window that turns sync on or off for a workspace, or gives it a new key,
 * activates it again under that key. Every other window with the workspace open
 * has to follow, or it keeps the old key, maybe a retired one, and the old
 * sync state.
 */
describe('a workspace whose sync another window changed', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		syncStore.activateLocalWorkspace(TEST_WORKSPACE);
		syncStore.profiles = [];
		localStorage.clear();
	});

	it('treats the open workspace as synced once another window turned sync on', async () => {
		const open = workspace('synced-elsewhere', false);
		syncStore.profiles = [open];
		syncStore.activateProfile(open);
		const reload = stubChange();
		const synced = { ...open, syncKey: createSyncIdentity().syncKey };
		localStorage.setItem('scrapscache-sync-profiles', JSON.stringify([synced]));

		await new ProfileCoordinator().adoptKeyring();

		expect(syncStore.activeId).toBe(open.id);
		expect(syncStore.isLoggedIn).toBe(true);
		expect(syncStore.account?.accountId).toBe(identityFromSyncKey(synced.syncKey).accountId);
		expect(reload).toHaveBeenCalledOnce();
	});

	it('drops the key once another window unlinked the workspace or deleted its cloud data', async () => {
		const open = workspace('unlinked-elsewhere', true);
		syncStore.profiles = [open];
		syncStore.activateProfile(open);
		// A delete retires the key; the retired state must not outlive it.
		syncStore.keyRetired = true;
		const reload = stubChange();
		localStorage.setItem('scrapscache-sync-profiles', JSON.stringify([{ ...open, syncKey: '' }]));

		await new ProfileCoordinator().adoptKeyring();

		expect(syncStore.activeId).toBe(open.id);
		expect(syncStore.isLoggedIn).toBe(false);
		expect(syncStore.keyRetired).toBe(false);
		expect(reload).toHaveBeenCalledOnce();
	});

	it('moves to the new key another window gave the workspace', async () => {
		const open = workspace('rekeyed-elsewhere', true);
		syncStore.profiles = [open];
		syncStore.activateProfile(open);
		const reload = stubChange();
		const rekeyed = { ...open, syncKey: createSyncIdentity().syncKey };
		localStorage.setItem('scrapscache-sync-profiles', JSON.stringify([rekeyed]));

		await new ProfileCoordinator().adoptKeyring();

		expect(syncStore.account?.accountId).toBe(identityFromSyncKey(rekeyed.syncKey).accountId);
		expect(reload).toHaveBeenCalledOnce();
	});

	it('leaves the window alone when the keyring changed but the open key did not', async () => {
		const open = workspace('same-key', true);
		const other = workspace('renamed-elsewhere', false, 2);
		syncStore.profiles = [open, other];
		syncStore.activateProfile(open);
		const reload = stubChange();
		const accountId = syncStore.account?.accountId;
		localStorage.setItem(
			'scrapscache-sync-profiles',
			JSON.stringify([open, { ...other, name: 'Renamed' }])
		);

		await new ProfileCoordinator().adoptKeyring();

		expect(syncStore.account?.accountId).toBe(accountId);
		expect(syncStore.profiles[1].name).toBe('Renamed');
		expect(reload).not.toHaveBeenCalled();
	});
});
