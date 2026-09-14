import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAllNotesMetadata, LOCAL_PROFILE_ID, putNote } from '$lib/db/idb';
import { createSyncIdentity } from '$lib/syncPairing';
import type { Note } from '$lib/types';
import { unregisterReminderDevice } from '$lib/reminderWake';
import { ProfileCoordinator } from './profiles.svelte';
import { notesStore, SYNC_LOCK } from './notes.svelte';
import { syncStore } from './sync.svelte';

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

describe('profile creation handover', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		syncStore.account = null;
		syncStore.profiles = [];
		notesStore.notes = [];
		notesStore.labels = [];
	});

	it('adopts anonymous notes when another saved profile still exists', async () => {
		const unlinked = {
			id: 'unlinked-profile',
			name: 'Unlinked',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 1
		};
		const remaining = {
			id: 'remaining-profile',
			name: 'Remaining',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 2
		};
		const created = {
			id: 'created-profile',
			name: 'Created',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 3
		};
		syncStore.profiles = [unlinked, remaining];
		syncStore.activateProfile(unlinked);
		await putNote(LOCAL_PROFILE_ID, note('anonymous-note'));
		await putNote(unlinked.id, note('unlinked-only-note'));

		await syncStore.logout();

		expect(syncStore.profiles).toEqual([remaining]);
		expect((await getAllNotesMetadata(LOCAL_PROFILE_ID)).map(({ id }) => id)).toEqual([
			'anonymous-note'
		]);
		expect(await getAllNotesMetadata(unlinked.id)).toEqual([]);

		vi.spyOn(notesStore, 'waitForPendingProfileWrites').mockResolvedValue();
		vi.spyOn(notesStore, 'reloadForProfile').mockResolvedValue();
		vi.spyOn(notesStore, 'syncWithCloudManual').mockResolvedValue(true);
		vi.spyOn(syncStore, 'queueOutbox').mockResolvedValue();
		vi.spyOn(syncStore, 'register').mockImplementation(async () => {
			syncStore.profiles = [remaining, created];
			syncStore.activateProfile(created);
			return { success: true, profile: created };
		});

		const result = await new ProfileCoordinator().create();

		expect(result).toEqual({ success: true });
		expect((await getAllNotesMetadata(created.id)).map(({ id }) => id)).toEqual(['anonymous-note']);
	});

	it('still starts blank when creating from an active synced profile', async () => {
		const active = {
			id: 'active-profile',
			name: 'Active',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 1
		};
		const created = {
			id: 'blank-profile',
			name: 'Blank',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 2
		};
		syncStore.profiles = [active];
		syncStore.activateProfile(active);
		await putNote(active.id, note('active-note'));
		await putNote(LOCAL_PROFILE_ID, note('unrelated-local-note'));

		vi.spyOn(notesStore, 'waitForPendingProfileWrites').mockResolvedValue();
		vi.spyOn(notesStore, 'reloadForProfile').mockResolvedValue();
		vi.spyOn(notesStore, 'syncWithCloudManual').mockResolvedValue(true);
		vi.spyOn(syncStore, 'queueOutbox').mockResolvedValue();
		vi.spyOn(syncStore, 'register').mockImplementation(async () => {
			syncStore.profiles = [active, created];
			syncStore.activateProfile(created);
			return { success: true, profile: created };
		});

		const result = await new ProfileCoordinator().create();

		expect(result).toEqual({ success: true });
		expect(await getAllNotesMetadata(created.id)).toEqual([]);
		expect((await getAllNotesMetadata(active.id)).map(({ id }) => id)).toEqual(['active-note']);
		expect((await getAllNotesMetadata(LOCAL_PROFILE_ID)).map(({ id }) => id)).toEqual([
			'unrelated-local-note'
		]);
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
				await putNote(LOCAL_PROFILE_ID, note('keep-anonymous'));
				vi.spyOn(notesStore, 'waitForPendingProfileWrites').mockResolvedValue();
				vi.spyOn(notesStore, 'reloadForProfile').mockResolvedValue();
				vi.spyOn(syncStore, 'queueOutbox').mockResolvedValue();
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
				expect((await getAllNotesMetadata(LOCAL_PROFILE_ID)).map(({ id }) => id)).toContain(
					'keep-anonymous'
				);
			} finally {
				vi.unstubAllGlobals();
			}
		}
	);

	it('force pushes using the same profile', async () => {
		const active = {
			id: 'force-resync-profile',
			name: 'Active',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 1
		};
		syncStore.profiles = [active];
		syncStore.activateProfile(active);

		vi.spyOn(notesStore, 'waitForPendingProfileWrites').mockResolvedValue();
		const sync = vi.spyOn(notesStore, 'forcePushWorkspace').mockResolvedValue(true);

		const result = await new ProfileCoordinator().forceResync();

		expect(result).toEqual({ success: true });
		expect(sync).toHaveBeenCalledTimes(1);
		expect(syncStore.profiles).toEqual([active]);
		expect(syncStore.activeProfile).toEqual(active);
	});

	it('activates another synced workspace before force pushing it', async () => {
		const active = {
			id: 'active-force-profile',
			name: 'Active',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 1
		};
		const other = {
			id: 'other-force-profile',
			name: 'Other',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 2
		};
		syncStore.profiles = [active, other];
		syncStore.activateProfile(active);

		vi.spyOn(notesStore, 'waitForPendingProfileWrites').mockResolvedValue();
		vi.spyOn(notesStore, 'reloadForProfile').mockResolvedValue();
		vi.spyOn(syncStore, 'queueOutbox').mockResolvedValue();
		const sync = vi.spyOn(notesStore, 'forcePushWorkspace').mockResolvedValue(true);
		const pull = vi.spyOn(notesStore, 'syncWithCloudManual');

		const result = await new ProfileCoordinator().forceResync(undefined, other.id);

		expect(result).toEqual({ success: true });
		expect(syncStore.activeProfile).toEqual(other);
		expect(sync).toHaveBeenCalledTimes(1);
		expect(pull).not.toHaveBeenCalled();
	});

	it('switches to the anonymous workspace without removing or syncing saved profiles', async () => {
		const active = {
			id: 'switch-from-profile',
			name: 'Active',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 1
		};
		syncStore.profiles = [active];
		syncStore.activateProfile(active);
		await putNote(active.id, note('synced-workspace-note'));
		await putNote(LOCAL_PROFILE_ID, note('anonymous-workspace-note'));

		vi.spyOn(notesStore, 'waitForPendingProfileWrites').mockResolvedValue();
		const reload = vi.spyOn(notesStore, 'reloadForProfile').mockResolvedValue();
		const sync = vi.spyOn(notesStore, 'syncWithCloudManual').mockResolvedValue(true);

		const result = await new ProfileCoordinator().switchTo(LOCAL_PROFILE_ID);

		expect(result).toEqual({ success: true });
		expect(syncStore.profiles).toEqual([active]);
		expect(syncStore.activePid).toBe(LOCAL_PROFILE_ID);
		expect(reload).toHaveBeenCalledTimes(1);
		expect(sync).not.toHaveBeenCalled();
		expect((await getAllNotesMetadata(active.id)).map(({ id }) => id)).toEqual([
			'synced-workspace-note'
		]);
		expect((await getAllNotesMetadata(LOCAL_PROFILE_ID)).map(({ id }) => id)).toContain(
			'anonymous-workspace-note'
		);
	});

	it('unlinks an inactive workspace and deletes its local notes', async () => {
		const inactive = {
			id: 'inactive-unlink-profile',
			name: 'Inactive',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 1
		};
		syncStore.profiles = [inactive];
		syncStore.activateLocalWorkspace();
		await putNote(LOCAL_PROFILE_ID, note('existing-anonymous-note'));
		await putNote(inactive.id, note('inactive-workspace-note'));

		vi.spyOn(notesStore, 'waitForPendingProfileWrites').mockResolvedValue();
		const reload = vi.spyOn(notesStore, 'reloadForProfile').mockResolvedValue();

		const result = await new ProfileCoordinator().unlinkSaved(inactive.id);

		expect(result).toEqual({ success: true });
		expect(syncStore.profiles).toEqual([]);
		expect(syncStore.activePid).toBe(LOCAL_PROFILE_ID);
		expect(reload).not.toHaveBeenCalled();
		expect((await getAllNotesMetadata(LOCAL_PROFILE_ID)).map(({ id }) => id)).toEqual([
			'existing-anonymous-note'
		]);
		expect(await getAllNotesMetadata(inactive.id)).toEqual([]);
	});

	it('unlinks the active workspace and deletes its local notes without touching the cloud', async () => {
		const active = {
			id: 'active-unlink-profile',
			name: 'Active',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 1
		};
		syncStore.profiles = [active];
		syncStore.activateProfile(active);
		await putNote(LOCAL_PROFILE_ID, note('existing-anonymous-note'));
		await putNote(active.id, note('synced-workspace-note'));

		vi.spyOn(notesStore, 'waitForPendingProfileWrites').mockResolvedValue();
		const reload = vi.spyOn(notesStore, 'reloadForProfile').mockResolvedValue();
		const deleteCloud = vi.spyOn(syncStore, 'deleteCloudAccount');
		vi.mocked(unregisterReminderDevice).mockResolvedValue(undefined);

		const result = await new ProfileCoordinator().unlink();

		expect(result).toEqual({ success: true });
		expect(deleteCloud).not.toHaveBeenCalled();
		expect(unregisterReminderDevice).toHaveBeenCalled();
		expect(syncStore.profiles).toEqual([]);
		expect(syncStore.account).toBeNull();
		expect(syncStore.activePid).toBe(LOCAL_PROFILE_ID);
		expect(reload).toHaveBeenCalledTimes(1);
		expect((await getAllNotesMetadata(LOCAL_PROFILE_ID)).map(({ id }) => id)).toEqual([
			'existing-anonymous-note'
		]);
		expect(await getAllNotesMetadata(active.id)).toEqual([]);
	});

	it('keeps local notes in anonymous storage when deleting cloud data', async () => {
		const active = {
			id: 'delete-cloud-profile',
			name: 'Active',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 1
		};
		syncStore.profiles = [active];
		syncStore.activateProfile(active);
		await putNote(LOCAL_PROFILE_ID, note('existing-anonymous-note'));
		await putNote(active.id, note('synced-workspace-note'));

		vi.spyOn(notesStore, 'waitForPendingProfileWrites').mockResolvedValue();
		vi.spyOn(notesStore, 'reloadForProfile').mockResolvedValue();
		vi.spyOn(syncStore, 'deleteCloudAccount').mockImplementation(async () => {
			await syncStore.logout(true);
			return { success: true };
		});

		const result = await new ProfileCoordinator().unlink(true);

		expect(result).toEqual({ success: true });
		expect((await getAllNotesMetadata(LOCAL_PROFILE_ID)).map(({ id }) => id)).toEqual(
			expect.arrayContaining(['existing-anonymous-note', 'synced-workspace-note'])
		);
	});

	it('creates an empty local workspace without copying notes or registering', async () => {
		syncStore.activateLocalWorkspace();
		await putNote(LOCAL_PROFILE_ID, note('stay-anonymous'));
		vi.spyOn(notesStore, 'waitForPendingProfileWrites').mockResolvedValue();
		const reload = vi.spyOn(notesStore, 'reloadForProfile').mockResolvedValue();
		const register = vi.spyOn(syncStore, 'register');

		const result = await new ProfileCoordinator().createLocal();

		expect(result).toEqual({ success: true });
		expect(register).not.toHaveBeenCalled();
		expect(syncStore.account).toBeNull();
		expect(syncStore.profiles).toHaveLength(1);
		expect(syncStore.profiles[0].syncKey).toBe('');
		expect(syncStore.activePid).toBe(syncStore.profiles[0].id);
		expect(reload).toHaveBeenCalledTimes(1);
		expect((await getAllNotesMetadata(LOCAL_PROFILE_ID)).map(({ id }) => id)).toEqual([
			'stay-anonymous'
		]);
		expect(await getAllNotesMetadata(syncStore.activePid)).toEqual([]);
	});

	it('copies notes from an extra local workspace when creating a synced one', async () => {
		const local = {
			id: 'extra-local',
			name: 'Local',
			syncKey: '',
			createdAt: 1
		};
		const created = {
			id: 'created-from-local',
			name: 'Created',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 2
		};
		syncStore.profiles = [local];
		syncStore.activateLocalWorkspace(local.id);
		await putNote(local.id, note('local-note'));

		vi.spyOn(notesStore, 'waitForPendingProfileWrites').mockResolvedValue();
		vi.spyOn(notesStore, 'reloadForProfile').mockResolvedValue();
		vi.spyOn(notesStore, 'syncWithCloudManual').mockResolvedValue(true);
		vi.spyOn(syncStore, 'queueOutbox').mockResolvedValue();
		vi.spyOn(syncStore, 'register').mockImplementation(async () => {
			syncStore.profiles = [local, created];
			syncStore.activateProfile(created);
			return { success: true, profile: created };
		});

		const result = await new ProfileCoordinator().create();

		expect(result).toEqual({ success: true });
		expect((await getAllNotesMetadata(created.id)).map(({ id }) => id)).toEqual(['local-note']);
		expect((await getAllNotesMetadata(local.id)).map(({ id }) => id)).toEqual(['local-note']);
	});

	it('wipes an extra local workspace and returns to anonymous', async () => {
		const local = {
			id: 'extra-local-wipe',
			name: 'Local',
			syncKey: '',
			createdAt: 1
		};
		syncStore.profiles = [local];
		syncStore.activateLocalWorkspace(local.id);
		await putNote(local.id, note('local-note'));
		await putNote(LOCAL_PROFILE_ID, note('anonymous-note'));
		vi.spyOn(notesStore, 'waitForPendingProfileWrites').mockResolvedValue();
		const reload = vi.spyOn(notesStore, 'reloadForProfile').mockResolvedValue();

		const result = await new ProfileCoordinator().wipeLocal(local.id);

		expect(result).toEqual({ success: true });
		expect(syncStore.profiles).toEqual([]);
		expect(syncStore.activePid).toBe(LOCAL_PROFILE_ID);
		expect(reload).toHaveBeenCalled();
		expect((await getAllNotesMetadata(LOCAL_PROFILE_ID)).map(({ id }) => id)).toEqual([
			'anonymous-note'
		]);
	});

	it('clears anonymous notes without removing saved profiles', async () => {
		const saved = {
			id: 'saved-profile',
			name: 'Saved',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 1
		};
		syncStore.profiles = [saved];
		syncStore.activateLocalWorkspace();
		await putNote(LOCAL_PROFILE_ID, note('wipe-me'));
		vi.spyOn(notesStore, 'waitForPendingProfileWrites').mockResolvedValue();
		const reload = vi.spyOn(notesStore, 'reloadForProfile').mockResolvedValue();

		const result = await new ProfileCoordinator().wipeLocal(LOCAL_PROFILE_ID);

		expect(result).toEqual({ success: true });
		expect(syncStore.profiles).toEqual([saved]);
		expect(syncStore.activePid).toBe(LOCAL_PROFILE_ID);
		expect(reload).toHaveBeenCalledTimes(1);
		expect(await getAllNotesMetadata(LOCAL_PROFILE_ID)).toEqual([]);
	});

	it('deletes cloud data for an inactive workspace without leaving the current one', async () => {
		const active = {
			id: 'active-keep-profile',
			name: 'Active',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 1
		};
		const other = {
			id: 'other-delete-cloud',
			name: 'Other',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 2
		};
		syncStore.profiles = [active, other];
		syncStore.activateProfile(active);
		vi.spyOn(notesStore, 'waitForPendingProfileWrites').mockResolvedValue();
		const deleteCloud = vi
			.spyOn(syncStore, 'deleteCloudAccount')
			.mockResolvedValue({ success: true });

		const result = await new ProfileCoordinator().unlinkSaved(other.id, true);

		expect(result).toEqual({ success: true });
		expect(deleteCloud).toHaveBeenCalledWith(other);
		expect(syncStore.activeProfile).toEqual(active);
	});

	it('rejects unlinking an unknown workspace without changing saved profiles', async () => {
		const kept = {
			id: 'kept-profile',
			name: 'Kept',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 1
		};
		syncStore.profiles = [kept];
		syncStore.activateLocalWorkspace();

		const result = await new ProfileCoordinator().unlinkSaved('missing-profile');

		expect(result).toEqual({
			success: false,
			error: 'That workspace is no longer on this device'
		});
		expect(syncStore.profiles).toEqual([kept]);
	});
});
