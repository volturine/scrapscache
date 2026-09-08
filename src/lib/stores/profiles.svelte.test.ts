import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAllNotesMetadata, LOCAL_PROFILE_ID, putNote } from '$lib/db/idb';
import { createSyncIdentity } from '$lib/syncPairing';
import type { Note } from '$lib/types';
import { ProfileCoordinator } from './profiles.svelte';
import { notesStore } from './notes.svelte';
import { syncStore } from './sync.svelte';

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
		await putNote(unlinked.id, note('anonymous-note'));

		await syncStore.logout();

		expect(syncStore.profiles).toEqual([remaining]);
		expect((await getAllNotesMetadata(LOCAL_PROFILE_ID)).map(({ id }) => id)).toEqual([
			'anonymous-note'
		]);

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
});
