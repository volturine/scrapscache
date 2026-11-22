import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8 } from 'fflate';
import { getAllNotesMetadata, getSyncOutboxKeys, waitForDeviceWrites } from '#lib/db/idb.js';
import { BackupImportMode, type ScrapsCacheBackup } from '#lib/backup.js';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { notesStore } from './notes.svelte';
import { SYNC_LOCK, syncScheduler } from './syncScheduler';
import { WORKSPACE_LOCK } from '#lib/webLock.js';
import { profileCoordinator } from './profiles.svelte';
import { syncStore } from './sync.svelte';
import { kanbanStore } from './kanban.svelte';
import { readCanvasLibrary } from '#lib/canvasLibrary.js';
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

const realPut = IDBObjectStore.prototype.put;

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

/** The sync lock as the browser grants it: one holder at a time, in request order. */
function serialLocks() {
	const chains = new Map<string, Promise<unknown>>();
	return {
		request: <T>(name: string, ...rest: unknown[]): Promise<T> => {
			const run = rest.at(-1) as () => Promise<T>;
			// Only the sync and workspace locks are under test; the others are theirs to take.
			if (name !== WORKSPACE_LOCK && !name.startsWith(SYNC_LOCK)) return run();
			const held = (chains.get(name) ?? Promise.resolve()).then(run);
			chains.set(
				name,
				held.catch(() => undefined)
			);
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
		await syncScheduler.reset();
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
		// Brought back, not edited: it keeps the dates the backup had for it.
		expect(restored).toMatchObject({ createdAt: 1, updatedAt: 1 });
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
		expect((await readCanvasLibrary(workspaceB.id)).tombstones).toHaveProperty('other');
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

	// An import can run for minutes. Nothing waits for it: the window moves on, and
	// the import lands in the workspace it was started for.
	it('lets the window switch while an import runs, and lands it in its own workspace', async () => {
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
			const running = notesStore.importBackup(
				emptyBackup([backupNote('first'), backupNote('second')]),
				BackupImportMode.Keep
			);

			expect(await profileCoordinator.switchTo(workspaceB.id)).toEqual({ success: true });
			expect(syncStore.activeId).toBe(workspaceB.id);

			releaseEstimate();
			expect(await running).toEqual({ success: true });
			expect(notesStore.importing).toBe(false);
			expect((await getAllNotesMetadata(workspaceA.id)).map((n) => n.title).sort()).toEqual([
				'first',
				'second'
			]);
			// Queued to upload with the notes, though the workspace is not open.
			expect(
				(await getSyncOutboxKeys(workspaceA.id)).filter((key) => key.startsWith('note:'))
			).toHaveLength(2);
			expect(await getAllNotesMetadata(workspaceB.id)).toEqual([]);
			expect(notesStore.notes).toEqual([]);
			expect(syncStore.activeId).toBe(workspaceB.id);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	// A sync flight reads the workspace, merges, and writes it back. Landing an
	// import partway through one would have the flight save the notes it pulled
	// over the imported ones and push the mixture to the relay as the newest version.
	it('lands only once it holds the sync lock of its workspace', async () => {
		await openWorkspace(workspaceA);
		vi.stubGlobal('navigator', { ...navigator, locks: serialLocks() });
		try {
			let releaseFlight!: () => void;
			const flight = navigator.locks.request(
				`${SYNC_LOCK}:${workspaceA.id}`,
				() => new Promise<void>((resolve) => (releaseFlight = resolve))
			);
			let landed = false;
			const running = notesStore
				.importBackup(emptyBackup([backupNote('imported')]), BackupImportMode.Keep)
				.finally(() => (landed = true));

			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(landed).toBe(false);
			expect(await getAllNotesMetadata(workspaceA.id)).toEqual([]);

			releaseFlight();
			await flight;
			expect(await running).toEqual({ success: true });
			expect((await getAllNotesMetadata(workspaceA.id)).map((note) => note.title)).toEqual([
				'imported'
			]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	// Everything an import writes is one transaction: a full disk, or a tab that
	// goes away part-way, leaves the workspace exactly as it was.
	it('leaves the workspace as it was when the import cannot be written', async () => {
		await openWorkspace(workspaceA);
		notesStore.createNote({ title: 'A note' });
		await waitForDeviceWrites(workspaceA.id);
		const queued = (await getSyncOutboxKeys(workspaceA.id)).sort();
		const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
			this: IDBObjectStore
		) {
			// The notes and their tombstones are already written when the labels fail.
			if (this.name === 'labels') throw new DOMException('Quota exceeded', 'QuotaExceededError');
			return Reflect.apply(realPut, this, arguments) as IDBRequest<IDBValidKey>;
		});
		try {
			const backup = emptyBackup([backupNote('imported')]);
			backup.labels = [{ id: 'label', name: 'Label', createdAt: 1, updatedAt: 1 }];
			const result = await notesStore.importBackup(backup, BackupImportMode.Replace);

			expect(result.success).toBe(false);
			expect(result.error).toMatch(/Could not import full backup/);
			put.mockRestore();
			expect((await getAllNotesMetadata(workspaceA.id)).map((note) => note.title)).toEqual([
				'A note'
			]);
			expect(notesStore.notes.map((note) => note.title)).toEqual(['A note']);
			expect(notesStore.deletedNoteIds).toEqual({});
			expect((await getSyncOutboxKeys(workspaceA.id)).sort()).toEqual(queued);
		} finally {
			put.mockRestore();
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
				`${SYNC_LOCK}:${workspaceA.id}`,
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
		chunk.missing = true;
		try {
			const result = await notesStore.importBackup(emptyBackup(), BackupImportMode.Replace);
			expect(result).toEqual({ success: false, error: STALE_MODULE_MESSAGE });
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

	// The window can be moved while an import waits for the lock. The import still
	// lands in the workspace it was started for, never in whatever is open by then:
	// that would replace a workspace nobody chose and push it to its cloud.
	it('lands in the workspace it was started in after the window has moved', async () => {
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
			const flight = navigator.locks.request(`${SYNC_LOCK}:${workspaceA.id}`, () => flightGate);
			// Queued ahead of the import, as a switch to another workspace would be.
			const moved = navigator.locks.request(WORKSPACE_LOCK, async () => {
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

			expect(await running).toEqual({ success: true });
			await waitForDeviceWrites();
			expect((await getAllNotesMetadata(workspaceA.id)).map((note) => note.title)).toEqual([
				'imported'
			]);
			expect((await getAllNotesMetadata(workspaceB.id)).map((note) => note.title)).toEqual([
				'B note'
			]);
			expect(notesStore.notes.map((note) => note.title)).toEqual(['B note']);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('imports nowhere once its workspace is gone from this device', async () => {
		await openWorkspace(workspaceB);
		notesStore.createNote({ title: 'B note' });
		await waitForDeviceWrites(workspaceB.id);
		await openWorkspace(workspaceA);
		vi.stubGlobal('navigator', { ...navigator, locks: serialLocks() });
		try {
			// Queued ahead of the import: another window removed the workspace, and
			// this window left it.
			const removed = navigator.locks.request(WORKSPACE_LOCK, async () => {
				syncStore.activateProfile(workspaceB);
				await notesStore.reloadForProfile();
				syncStore.profiles = syncStore.profiles.filter((entry) => entry.id !== workspaceA.id);
			});
			const result = await notesStore.importBackup(
				emptyBackup([backupNote('imported')]),
				BackupImportMode.Replace
			);
			await removed;

			expect(result.success).toBe(false);
			expect(result.error).toMatch(/no longer on this device/);
			expect((await getAllNotesMetadata(workspaceB.id)).map((note) => note.title)).toEqual([
				'B note'
			]);
			expect(await getAllNotesMetadata(workspaceA.id)).toEqual([]);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
