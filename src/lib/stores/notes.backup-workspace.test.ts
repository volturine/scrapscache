import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8 } from 'fflate';
import { getAllNotesMetadata, LOCAL_PROFILE_ID, waitForDeviceWrites } from '$lib/db/idb';
import { BackupImportMode, type ScrapsCacheBackup } from '$lib/backup';
import { createSyncIdentity } from '$lib/syncPairing';
import { notesStore } from './notes.svelte';
import { profileCoordinator } from './profiles.svelte';
import { syncStore } from './sync.svelte';

function profile(id: string) {
	const account = createSyncIdentity();
	return { id, name: id, syncKey: account.syncKey, createdAt: 1 };
}

function emptyBackup(notes: ScrapsCacheBackup['notes'] = []): ScrapsCacheBackup {
	return {
		version: 4,
		exportedAt: 1,
		notes,
		labels: [],
		boards: [],
		activeBoardId: '',
		tombstones: {},
		labelTombstones: {},
		boardTombstones: {},
		ui: { sidebarOpen: true, dark: null, layout: 'grid', view: 'notes' }
	};
}

async function openWorkspace(target: {
	id: string;
	name: string;
	syncKey: string;
	createdAt: number;
}) {
	syncStore.profiles = [...syncStore.profiles.filter((entry) => entry.id !== target.id), target];
	syncStore.activateProfile(target);
	await notesStore.reloadForProfile();
}

describe('backup and Keep import stay in the open workspace', () => {
	const workspaceA = profile('workspace-a');
	const workspaceB = profile('workspace-b');

	beforeEach(() => {
		localStorage.clear();
		syncStore.account = null;
		syncStore.profiles = [];
		notesStore.notes = [];
		notesStore.labels = [];
	});

	afterEach(() => {
		const internals = notesStore as unknown as {
			dirty: boolean;
			syncPushTimer: ReturnType<typeof setTimeout> | null;
		};
		if (internals.syncPushTimer) clearTimeout(internals.syncPushTimer);
		internals.syncPushTimer = null;
		internals.dirty = false;
		syncStore.account = null;
		syncStore.profiles = [];
		notesStore.notes = [];
		notesStore.labels = [];
	});

	it('exports only the open workspace and never the sync key', async () => {
		await openWorkspace(workspaceA);
		notesStore.createNote({ title: 'Alpha' });
		await waitForDeviceWrites(workspaceA.id);

		await openWorkspace(workspaceB);
		notesStore.createNote({ title: 'Beta' });
		await waitForDeviceWrites(workspaceB.id);

		const backup = await notesStore.exportBackup();
		const serialized = JSON.stringify(backup);

		expect(backup.notes.map((note) => note.title)).toEqual(['Beta']);
		expect(Object.keys(backup).sort()).toEqual([
			'activeBoardId',
			'boardTombstones',
			'boards',
			'exportedAt',
			'labelTombstones',
			'labels',
			'notes',
			'tombstones',
			'ui',
			'version'
		]);
		expect(serialized).not.toContain(workspaceA.syncKey);
		expect(serialized).not.toContain(workspaceB.syncKey);
		expect(serialized).not.toContain('syncKey');
		expect(serialized).not.toContain('"sync"');
	});

	it('imports a Scraps Cache backup only into the open workspace', async () => {
		await openWorkspace(workspaceA);
		notesStore.createNote({ title: 'Stay' });
		await waitForDeviceWrites(workspaceA.id);

		await openWorkspace(workspaceB);
		const result = await notesStore.importBackup(
			emptyBackup([
				{
					id: 'imported',
					title: 'Incoming',
					body: '',
					color: 'default',
					pinned: false,
					archived: false,
					trashed: false,
					trashedAt: null,
					createdAt: 1,
					updatedAt: 1,
					reminder: null,
					labels: []
				}
			]),
			BackupImportMode.Keep
		);
		await waitForDeviceWrites(workspaceB.id);

		expect(result).toEqual({ success: true });
		expect((await getAllNotesMetadata(workspaceB.id)).map((note) => note.title)).toEqual([
			'Incoming'
		]);
		expect((await getAllNotesMetadata(workspaceA.id)).map((note) => note.title)).toEqual(['Stay']);
		expect(await getAllNotesMetadata(LOCAL_PROFILE_ID)).toEqual([]);
	});

	it('imports Google Keep notes only into the open workspace', async () => {
		await openWorkspace(workspaceA);
		notesStore.createNote({ title: 'Stay' });
		await waitForDeviceWrites(workspaceA.id);

		await openWorkspace(workspaceB);
		const result = await notesStore.importKeepTakeout(
			{
				'Takeout/Keep/Note.json': strToU8(
					JSON.stringify({
						color: 'DEFAULT',
						isTrashed: false,
						isPinned: false,
						isArchived: false,
						title: 'Keep note',
						textContent: 'Body',
						userEditedTimestampUsec: 1_700_000_000_000_000,
						createdTimestampUsec: 1_600_000_000_000_000
					})
				)
			},
			BackupImportMode.Keep
		);
		await waitForDeviceWrites(workspaceB.id);

		expect(result).toEqual({ success: true });
		expect((await getAllNotesMetadata(workspaceB.id)).map((note) => note.title)).toEqual([
			'Keep note'
		]);
		expect((await getAllNotesMetadata(workspaceA.id)).map((note) => note.title)).toEqual(['Stay']);
		expect(await getAllNotesMetadata(LOCAL_PROFILE_ID)).toEqual([]);
	});

	it('keeps a running import in its workspace and blocks switching until it finishes', async () => {
		await openWorkspace(workspaceB);
		await openWorkspace(workspaceA);
		let releaseEstimate!: () => void;
		const estimateGate = new Promise<void>((resolve) => (releaseEstimate = resolve));
		vi.stubGlobal('navigator', {
			...navigator,
			locks: undefined,
			storage: {
				estimate: async () => {
					await estimateGate;
					return { quota: 1e12, usage: 0 };
				}
			}
		});
		try {
			const note = (id: string) => ({
				id,
				title: id,
				body: '',
				color: 'default' as const,
				pinned: false,
				archived: false,
				trashed: false,
				trashedAt: null,
				createdAt: 1,
				updatedAt: 1,
				reminder: null,
				labels: []
			});
			const running = notesStore.importBackup(
				emptyBackup([note('first'), note('second')]),
				BackupImportMode.Keep
			);

			const switched = await profileCoordinator.switchTo(workspaceB.id);
			expect(switched.success).toBe(false);
			expect(switched.error).toMatch(/import/i);
			expect(syncStore.activeId).toBe(workspaceA.id);

			releaseEstimate();
			expect(await running).toEqual({ success: true });
			await waitForDeviceWrites(workspaceA.id);
			expect((await getAllNotesMetadata(workspaceA.id)).map((n) => n.title).sort()).toEqual([
				'first',
				'second'
			]);
			expect(await getAllNotesMetadata(workspaceB.id)).toEqual([]);
			expect(await profileCoordinator.switchTo(workspaceB.id)).toMatchObject({ success: true });
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
