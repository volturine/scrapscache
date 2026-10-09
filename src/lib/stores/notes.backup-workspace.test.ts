import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8 } from 'fflate';
import { getAllNotesMetadata, waitForDeviceWrites } from '#lib/db/idb.js';
import { BackupImportMode, type ScrapsCacheBackup } from '#lib/backup.js';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { notesStore, SYNC_LOCK } from './notes.svelte';
import { profileCoordinator } from './profiles.svelte';
import { syncStore } from './sync.svelte';
import { kanbanStore } from './kanban.svelte';
import { canvasLibraryStore } from './canvasLibrary';
import { reminderHistoryStore } from './reminderHistory';
import { reminderWakeId } from '#lib/model/index.js';
import { STALE_MODULE_MESSAGE } from '#lib/staleModuleReload.js';
import { TEST_WORKSPACE } from '../../tests/workspace';

// The import's code loads on demand; `chunk.missing` stands in for a deploy
// that no longer serves it, after the one reload that did not help.
const chunk = vi.hoisted(() => ({ missing: false }));
vi.mock('#lib/staleModuleReload.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/staleModuleReload.js')>();
	return {
		...actual,
		loadLazyModule: <T>(load: () => Promise<T>) =>
			chunk.missing
				? Promise.reject(new Error(actual.STALE_MODULE_MESSAGE))
				: actual.loadLazyModule(load)
	};
});

function profile(id: string) {
	const account = createSyncIdentity();
	return { id, name: id, syncKey: account.syncKey, createdAt: 1 };
}

function emptyBackup(notes: ScrapsCacheBackup['notes'] = []): ScrapsCacheBackup {
	return {
		version: 5,
		exportedAt: 1,
		notes,
		labels: [],
		boards: [],
		activeBoardId: '',
		tombstones: {},
		labelTombstones: {},
		boardTombstones: {},
		canvasLibrary: [],
		reminderHistory: [],
		ui: { sidebarOpen: true, dark: null, layout: 'grid', view: 'notes', rawMarkdown: false }
	};
}

function backupNote(id: string): ScrapsCacheBackup['notes'][number] {
	return {
		id,
		title: id,
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
	};
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

	afterEach(async () => {
		const internals = notesStore as unknown as {
			dirty: boolean;
			syncPushTimer: ReturnType<typeof setTimeout> | null;
			syncFlight: Promise<boolean> | null;
		};
		// A switch leaves its sync running; let it settle before the next test.
		await internals.syncFlight?.catch(() => false);
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
			'canvasLibrary',
			'exportedAt',
			'labelTombstones',
			'labels',
			'notes',
			'reminderHistory',
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
		expect(await getAllNotesMetadata(TEST_WORKSPACE)).toEqual([]);
	});

	it('restores a replacement backup under new ids and retires every old id', async () => {
		await openWorkspace(workspaceA);
		const existing = notesStore.createNote({ title: 'Before restore' });
		await waitForDeviceWrites(workspaceA.id);
		const backup = {
			...emptyBackup([backupNote('restored')]),
			boards: [
				{
					id: 'board',
					name: 'Board',
					createdAt: 1,
					updatedAt: 1,
					columns: [{ id: 'column', labelId: null, order: ['restored'] }],
					backlogFilter: { labelIds: [], search: '' }
				}
			]
		} as unknown as ScrapsCacheBackup;

		const result = await notesStore.importBackup(backup, BackupImportMode.Replace);

		expect(result).toEqual({ success: true });
		const [restored] = notesStore.notes;
		// Under the old id, the restored body would merge into newer synced text.
		expect(restored.title).toBe('restored');
		expect(restored.id).not.toBe('restored');
		expect(notesStore.deletedNoteIds).toMatchObject({
			restored: expect.any(Number),
			[existing.id]: expect.any(Number)
		});
		expect(kanbanStore.boards[0].columns[0].order).toEqual([restored.id]);
	});

	it('carries the canvas library and reminder history through a backup', async () => {
		await openWorkspace(workspaceA);
		const shape = { id: 'star', status: 'unpublished', created: 1, elements: [] };
		canvasLibraryStore.applyEditorChange([], [shape]);
		const reminder = 5_000;
		const noted = notesStore.createNote({ title: 'Call back', reminder });
		const wake = reminderWakeId(noted.id, reminder);
		reminderHistoryStore.recordDismissed(
			workspaceA.id,
			{ id: wake, noteId: noted.id, firedAt: reminder },
			9
		);
		await waitForDeviceWrites(workspaceA.id);

		const backup = await notesStore.exportBackup();
		expect(backup.canvasLibrary).toEqual([shape]);
		expect(backup.reminderHistory).toEqual([
			{ id: wake, noteId: noted.id, firedAt: reminder, dismissedAt: 9 }
		]);

		await openWorkspace(workspaceB);
		canvasLibraryStore.applyEditorChange([], [{ ...shape, id: 'other' }]);
		expect(await notesStore.importBackup(backup, BackupImportMode.Replace)).toEqual({
			success: true
		});

		expect(canvasLibraryStore.items()).toEqual([shape]);
		expect(canvasLibraryStore.tombstonesForSync()).toHaveProperty('other');
		const [restored] = notesStore.notes;
		// Already dismissed before the backup, so the restored note does not remind again.
		expect(reminderHistoryStore.get(reminderWakeId(restored.id, reminder))).toMatchObject({
			noteId: restored.id,
			dismissedAt: 9
		});
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
		expect(await getAllNotesMetadata(TEST_WORKSPACE)).toEqual([]);
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

	// A sync flight reads the workspace, merges, and writes it back. Landing that
	// partway through an import would write the notes it pulled over the imported
	// ones and push the mixture to the relay as the newest version.
	it('keeps a sync flight out of the workspace until the import finishes', async () => {
		await openWorkspace(workspaceA);
		let releaseEstimate!: () => void;
		const estimateGate = new Promise<void>((resolve) => (releaseEstimate = resolve));
		const order: string[] = [];
		vi.stubGlobal('navigator', {
			...navigator,
			locks: serialLocks(),
			storage: {
				estimate: async () => {
					order.push('import');
					await estimateGate;
					return { quota: 1e12, usage: 0 };
				}
			}
		});
		try {
			const running = notesStore.importBackup(
				emptyBackup([backupNote('imported')]),
				BackupImportMode.Keep
			);
			// What a flight does: ask for the same lock the handover uses.
			const flight = navigator.locks.request(SYNC_LOCK, async () => {
				order.push('flight');
			});
			// The import loads its validation before asking for the lock, so the flight
			// may land first; what matters is that it never lands during the import.
			await vi.waitFor(() => expect(order).toContain('import'));
			const during = order.length;
			for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
			expect(order).toHaveLength(during);
			expect(order.at(-1)).toBe('import');

			releaseEstimate();
			expect(await running).toEqual({ success: true });
			await flight;

			expect(order.sort()).toEqual(['flight', 'import']);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('refuses a bad file before waiting for the lock and leaves the workspace alone', async () => {
		await openWorkspace(workspaceA);
		notesStore.createNote({ title: 'A note' });
		await waitForDeviceWrites(workspaceA.id);
		vi.stubGlobal('navigator', { ...navigator, locks: serialLocks() });
		try {
			let releaseFlight!: () => void;
			const flight = navigator.locks.request(
				SYNC_LOCK,
				() => new Promise<void>((resolve) => (releaseFlight = resolve))
			);
			const result = await notesStore.importBackup({ version: 1 }, BackupImportMode.Replace);
			expect(result).toEqual({
				success: false,
				error: 'That file is not a valid Scraps Cache full backup.'
			});
			expect(notesStore.importing).toBe(false);
			releaseFlight();
			await flight;
			expect((await getAllNotesMetadata(workspaceA.id)).map((note) => note.title)).toEqual([
				'A note'
			]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	// The import's code loads on demand. When the deployed app no longer serves
	// that chunk, nothing has been written, so it is not a persistence error.
	it('reports a chunk that failed to load without touching the workspace', async () => {
		await openWorkspace(workspaceA);
		notesStore.createNote({ title: 'A note' });
		await waitForDeviceWrites(workspaceA.id);
		const hardResync = vi.spyOn(notesStore, 'hardResync');
		chunk.missing = true;
		try {
			const result = await notesStore.importBackup(emptyBackup(), BackupImportMode.Replace);
			expect(result).toEqual({ success: false, error: STALE_MODULE_MESSAGE });
			expect(hardResync).not.toHaveBeenCalled();
			expect(notesStore.lastPersistError).toBeNull();
			expect(notesStore.importing).toBe(false);
			expect((await getAllNotesMetadata(workspaceA.id)).map((note) => note.title)).toEqual([
				'A note'
			]);
		} finally {
			chunk.missing = false;
			vi.restoreAllMocks();
		}
	});

	// The window can be moved while an import waits for the lock: another window
	// removed its workspace, and the handover that follows queued first. Landing
	// in whatever is open once the lock comes would replace a workspace nobody
	// chose and push that to its cloud.
	it('imports into the workspace it was started in or nowhere', async () => {
		await openWorkspace(workspaceB);
		notesStore.createNote({ title: 'B note' });
		await waitForDeviceWrites(workspaceB.id);
		await openWorkspace(workspaceA);
		notesStore.createNote({ title: 'A note' });
		await waitForDeviceWrites(workspaceA.id);
		vi.stubGlobal('navigator', { ...navigator, locks: serialLocks() });
		try {
			let releaseFlight!: () => void;
			const flightGate = new Promise<void>((resolve) => (releaseFlight = resolve));
			const flight = navigator.locks.request(SYNC_LOCK, () => flightGate);
			// Queued ahead of the import, as a handover to another workspace would be.
			const moved = navigator.locks.request(SYNC_LOCK, async () => {
				syncStore.activateProfile(workspaceB);
				await notesStore.reloadForProfile();
			});
			const running = notesStore.importBackup(
				emptyBackup([backupNote('imported')]),
				BackupImportMode.Replace
			);

			releaseFlight();
			await flight;
			await moved;
			const result = await running;

			expect(result.success).toBe(false);
			expect(result.error).toMatch(/no longer open/);
			await waitForDeviceWrites();
			expect((await getAllNotesMetadata(workspaceB.id)).map((note) => note.title)).toEqual([
				'B note'
			]);
			expect((await getAllNotesMetadata(workspaceA.id)).map((note) => note.title)).toEqual([
				'A note'
			]);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
