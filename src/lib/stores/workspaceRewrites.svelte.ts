// Rewriting a workspace: bringing in a backup or a Google Keep Takeout, and making
// this device's copy the cloud's. Each is planned with nothing held and lands whole
// in one transaction, for the workspace it was started for, whichever one the
// window shows by then. A window that shows that workspace loads it again.
import type { Note } from '#lib/types.js';
import {
	getAllLabels,
	getAllNotesMetadata,
	getStoredAttachmentVersions,
	hydrateNoteAttachments,
	isProfileReleased,
	rewriteWorkspace,
	type RewritePlan,
	uploadGeneration
} from '#lib/db/idb.js';
import { isTombstoned, withoutTombstoned } from '#lib/model/index.js';
import { editContext, syncClock } from '#lib/editContext.js';
import { relaySync, syncStore } from '#lib/stores/sync.svelte.js';
import { relay } from '#lib/relayClient.js';
import { clearBoardsMirror, kanbanStore } from '#lib/stores/kanban.svelte.js';
import { reminderHistoryStore } from '#lib/stores/reminderHistory.js';
import { uiStore } from '#lib/stores/ui.svelte.js';
import { writeLabelsMirror, writeNotesMirror } from '#lib/noteStorage.js';
import {
	BOARD_IDB,
	BOARDS_IDB,
	LABEL_IDB,
	NOTE_IDB,
	readStoredTombstones
} from '#lib/syncTombstones.js';
import { fileToNoteImage } from '#lib/noteImages.js';
import { replacementFitsStorage } from '#lib/storageCapacity.js';
import { formatStorageError } from '#lib/imageBlob.js';
import { BackupImportMode, importedReminderHistory, prepareImportedNotes } from '#lib/backup.js';
import { loadLazyModule } from '#lib/staleModuleReload.js';
import { planBackupImport, planKeepImport } from '#lib/workspaceImport.js';
import { identityFromSyncKey } from '#lib/syncPairing.js';
import { syncScheduler } from '#lib/stores/syncScheduler.js';
import { localWritesLanded } from '#lib/localWrites.js';
import { withWorkspaceLock } from '#lib/webLock.js';
import { readWorkspace } from '#lib/workspaceSync.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { withinTime } from '#lib/syncRetry.js';
import { buildForcePushSnapshot } from '#lib/syncForcePush.js';
import { CANVAS_LIBRARY_STATE_KEY, CANVAS_LIBRARY_TOMBSTONES_KEY } from '#lib/canvasLibrary.js';
import { currentRecordKeys } from '#lib/syncEngine.js';
import type { SyncSnapshot } from '#lib/syncRecords.js';
import type { StoredProfile } from '#lib/profiles.js';

const IMPORT_TARGET_GONE =
	'The workspace this import was meant for is no longer on this device. Nothing was imported.';

/**
 * Load the code an import needs. Nothing has been written yet, so a chunk that
 * failed to load is an answer for the person, not a persistence error.
 */
async function loadImportModule<T>(
	load: () => Promise<T>
): Promise<{ success: true; module: T } | { success: false; error: string }> {
	try {
		return { success: true, module: await loadLazyModule(load) };
	} catch (cause) {
		return {
			success: false,
			error: cause instanceof Error ? cause.message : 'Could not load the import.'
		};
	}
}

/** A save landed in the workspace between a plan reading it and the plan landing. */
class WorkspaceChanged extends Error {}

/** How long replacing the relay's copy waits for photo saves under way before giving up. */
const BYTES_LANDING_MS = 15_000;

/**
 * What makes this device's copy of a workspace the relay's. `remote` and `control`
 * are what `relaySync.read` answered. Decided from what the database holds now: every
 * record is stamped past the relay's copy, and what only the relay holds is
 * deleted. It lands with the sync state of the copy that was read and with every
 * record queued, so the sync after it sends whatever differs and downloads nothing
 * twice. Nothing is changed on this device or the relay until it lands.
 *
 * It lands whole over what it read, so it refuses to land, with `WorkspaceChanged`,
 * when anything was saved in the workspace since: whoever runs it plans again.
 */
async function planRelayReplacement(
	pid: string,
	remote: SyncSnapshot,
	control: Record<string, unknown>,
	signal: AbortSignal
): Promise<RewritePlan> {
	await localWritesLanded(pid);
	// Taken first: whatever is saved from here on, the photos held included, is
	// noticed when the plan lands.
	const readAt = await uploadGeneration(pid);
	// This copy becomes the relay's, so every photo it lists has to be here in the
	// version listed: one that was never received, or could not be saved, stops it.
	// Asking waits for photo saves under way, which a save that keeps failing never
	// ends: it is given up rather than waited for with a workspace held.
	const held = await withinTime(BYTES_LANDING_MS, signal, (limited) =>
		getStoredAttachmentVersions(pid, limited)
	).catch(() => {
		throw new Error('Photos are still being saved on this device. Try again in a moment.');
	});
	const stored = await readWorkspace(pid);
	const notes = withoutTombstoned(stored.notes, stored.tombstones);
	for (const note of notes) {
		for (const image of note.images ?? []) {
			const version = held.get(`${note.id}::${image.id}`);
			if (version === undefined || (image.contentHash && image.contentHash !== version))
				throw new Error(
					'Some attachments could not be loaded. Replacing the cloud copy was not started.'
				);
		}
	}
	const local: SyncSnapshot = {
		...stored,
		// A note the relay deleted for good returns under a new id, and its bytes with it.
		notes: await Promise.all(
			notes.map((note) =>
				isTombstoned(note.id, remote.tombstones) ? hydrateNoteAttachments(pid, note) : note
			)
		),
		labels: withoutTombstoned(stored.labels, stored.labelTombstones)
	};
	const snapshot = buildForcePushSnapshot(local, remote, editContext);
	// Records that return under a new id leave nothing behind under the old one.
	const kept = new Set(snapshot.notes.map((note) => note.id));
	const keptLabels = new Set(snapshot.labels.map((label) => label.id));
	return {
		notes: snapshot.notes,
		stateKeys: [],
		land: (now) => {
			if (now.uploadGeneration !== readAt) throw new WorkspaceChanged();
			return {
				clear: false,
				notes: snapshot.notes,
				labels: snapshot.labels,
				dropNotes: now.noteIds.filter((id) => !kept.has(id)),
				dropLabels: now.labels.flatMap((label) => (keptLabels.has(label.id) ? [] : [label.id])),
				state: {
					[NOTE_IDB]: snapshot.tombstones,
					[LABEL_IDB]: snapshot.labelTombstones,
					[BOARD_IDB]: snapshot.boardTombstones,
					[BOARDS_IDB]: JSON.parse(JSON.stringify(snapshot.boards)),
					[CANVAS_LIBRARY_STATE_KEY]: JSON.parse(JSON.stringify(snapshot.libraryItems)),
					[CANVAS_LIBRARY_TOMBSTONES_KEY]: snapshot.libraryTombstones,
					...control
				},
				outboxKeys: currentRecordKeys(snapshot)
			};
		}
	};
}

/** Bring a workspace's fast-boot mirror level with its database once a rewrite has landed. */
async function mirrorFromDevice(pid: string): Promise<void> {
	const [notes, labels, tombstones] = await Promise.all([
		getAllNotesMetadata(pid),
		getAllLabels(pid),
		readStoredTombstones(pid)
	]);
	writeNotesMirror(withoutTombstoned(notes, tombstones.notes), pid);
	writeLabelsMirror(withoutTombstoned(labels, tombstones.labels), pid);
}

class WorkspaceRewrites {
	/** True while a backup or Keep import this window started is running. Nothing waits for it. */
	importing = $state(false);

	/**
	 * Bring a full backup into the workspace on screen. Adding keeps what is there;
	 * replacing leaves only the backup. See `runImport` for how it lands.
	 */
	importBackup(
		data: unknown,
		mode: BackupImportMode
	): Promise<{ success: boolean; error?: string }> {
		return this.runImport('Could not import full backup', async (pid) => {
			// Validation loads only when a backup is imported.
			const loaded = await loadImportModule(() => import('#lib/backupNormalize.js'));
			if (!loaded.success) return loaded;
			const backup = loaded.module.normalizeBackup(data);
			if (!backup)
				return { success: false, error: 'That file is not a valid Scraps Cache full backup.' };
			const notes = prepareImportedNotes(backup.notes, mode, editContext);
			const replace = mode === BackupImportMode.Replace;
			return {
				success: true,
				notes,
				plan: (accountId) =>
					planBackupImport({ backup, notes, mode, now: syncClock.now(), accountId }),
				// Recorded before the notes land, so reminders a device already handled stay handled.
				beforeLanding: () =>
					reminderHistoryStore.restore(
						pid,
						importedReminderHistory(backup.notes, notes, backup.reminderHistory)
					),
				// The workspace is the backup's now: a mirror of the boards before would merge
				// back in, and so would a change from before that was never saved.
				afterLanding: replace ? () => notesStore.forgetUnsaved(pid) : undefined,
				whenOpen: replace
					? () => {
							if (
								backup.activeBoardId &&
								kanbanStore.boards.some((board) => board.id === backup.activeBoardId)
							) {
								kanbanStore.selectBoard(backup.activeBoardId);
							}
							uiStore.restoreState(backup.ui);
						}
					: undefined
			};
		});
	}

	/** Bring the notes of a Google Keep Takeout into the workspace on screen. */
	importKeepTakeout(
		files: Record<string, Uint8Array>,
		mode: BackupImportMode
	): Promise<{ success: boolean; error?: string }> {
		return this.runImport('Could not import Google Keep notes', async (pid) => {
			// The Keep reader loads only when a Takeout is imported.
			const loaded = await loadImportModule(() => import('#lib/keepImport.js'));
			if (!loaded.success) return loaded;
			const { materializeKeepTakeout, readKeepTakeout } = loaded.module;
			if (readKeepTakeout(files).notes.length === 0)
				return { success: false, error: 'That zip does not contain Google Keep notes.' };
			const { notes, labels } = await materializeKeepTakeout(files, (file) =>
				fileToNoteImage(file, 'compressed')
			);
			return {
				success: true,
				notes,
				plan: () => planKeepImport({ notes, labels, mode, now: Date.now() }),
				afterLanding:
					mode === BackupImportMode.Replace ? () => notesStore.forgetUnsaved(pid) : undefined
			};
		});
	}

	/**
	 * Run an import for the workspace on screen when it was chosen. It lands there
	 * or nowhere, wherever this window has gone meanwhile, and nothing waits for it:
	 * the file is read and its photos are prepared before anything is locked, and a
	 * workspace switch goes ahead while that runs.
	 *
	 * Landing is one transaction under the sync lock, taken from a sync in progress
	 * rather than waited for. A sync that landed part-way through an import would
	 * save the notes it pulled over the imported ones; a tab killed part-way leaves
	 * the workspace as it was. What lands is queued to upload in that transaction,
	 * and is sent whether or not the workspace is the open one.
	 */
	private async runImport(
		failure: string,
		prepare: (pid: string) => Promise<
			| { success: false; error: string }
			| {
					success: true;
					notes: Note[];
					plan: (accountId: string | null) => RewritePlan;
					beforeLanding?: () => void;
					afterLanding?: () => void;
					/** Finishes an import whose workspace is still the open one. */
					whenOpen?: () => void;
			  }
		>
	): Promise<{ success: boolean; error?: string }> {
		if (this.importing) return { success: false, error: 'An import is already running.' };
		const pid = syncStore.activeId;
		this.importing = true;
		try {
			const prepared = await prepare(pid);
			if (!prepared.success) return prepared;
			if (navigator.storage?.estimate) {
				const estimate = await navigator.storage.estimate();
				if (!replacementFitsStorage(prepared.notes, estimate)) {
					return {
						success: false,
						error: 'Storage full on this device — free space or remove old notes/attachments.'
					};
				}
			}
			const there = await this.land(
				pid,
				(profile) => {
					prepared.beforeLanding?.();
					return prepared.plan(
						profile.syncKey ? identityFromSyncKey(profile.syncKey).accountId : null
					);
				},
				{
					landed: () => {
						prepared.afterLanding?.();
						// An import is not a first start: a workspace it leaves empty stays empty.
						if (typeof localStorage !== 'undefined')
							localStorage.setItem('scrapscache-seeded', '1');
					},
					whenOpen: prepared.whenOpen
				}
			);
			return there ? { success: true } : { success: false, error: IMPORT_TARGET_GONE };
		} catch (err) {
			// Only the open workspace's trouble shows on its sync indicator.
			if (pid === syncStore.activeId) notesStore.recordPersistenceError(failure, err);
			else console.error(`[notes] ${failure}`, err);
			return { success: false, error: `${failure}: ${formatStorageError(err)}` };
		} finally {
			this.importing = false;
		}
	}

	/**
	 * Rewrite a workspace's database in one step, whichever workspace this window
	 * shows; false when the workspace is no longer on this device. `plan` decides what
	 * lands from what the database holds once this window's own saves are in. It runs
	 * under the workspace lock, so the window stays where it is, and as a rewrite, so
	 * a sync of the workspace gives way instead of saving part-way through it. Only
	 * this device is touched while those are held. A window showing the workspace
	 * loads it again from what landed, and what landed is sent whichever workspace is
	 * open by then.
	 */
	private land(
		pid: string,
		plan: (profile: StoredProfile, signal: AbortSignal) => RewritePlan | Promise<RewritePlan>,
		then: { landed?: () => void; whenOpen?: () => void } = {}
	): Promise<boolean> {
		return withWorkspaceLock(() =>
			syncScheduler.rewrite(pid, async (signal) => {
				// The workspace may have been removed while the rewrite was prepared.
				const profile = syncStore.profiles.find((entry) => entry.id === pid);
				if (!profile || isProfileReleased(pid)) return false;
				for (let attempt = 0; ; attempt += 1) {
					// What this window has still to save is part of what the rewrite lands on.
					if (pid === syncStore.activeId) await notesStore.waitForPendingProfileWrites();
					const { notes, stateKeys, land } = await plan(profile, signal);
					try {
						await rewriteWorkspace(pid, notes, stateKeys, land);
						break;
					} catch (err) {
						// Something was saved between the plan reading and landing: plan again.
						if (!(err instanceof WorkspaceChanged)) throw err;
						if (attempt === 2) throw new Error('This workspace kept changing. Try again.');
					}
				}
				// It has landed, and stays landed whatever goes wrong from here: the rest
				// only shows it and gets it sent.
				try {
					// The mirrors are only a faster start. A full `localStorage` must not keep
					// what has landed from being loaded and sent.
					then.landed?.();
					await mirrorFromDevice(pid);
				} catch (err) {
					console.error('[notes] could not refresh the mirrors after a rewrite', err);
				}
				try {
					if (pid === syncStore.activeId) {
						await notesStore.reloadForProfile();
						then.whenOpen?.();
					}
				} catch (err) {
					notesStore.recordPersistenceError('Could not show what a rewrite landed', err);
				} finally {
					syncScheduler.changed(pid);
					syncScheduler.announce(pid, true);
				}
				return true;
			})
		);
	}

	/**
	 * Make this device's copy of a workspace the cloud's, whichever workspace this
	 * window shows. The relay is asked before anything is held, and nothing changes
	 * while it answers. Then this device's copy is stamped past the cloud's in one
	 * step, with everything queued, and an ordinary sync sends it.
	 */
	async forcePush(
		pid: string,
		turnstileToken?: string
	): Promise<{ success: boolean; error?: string }> {
		const profile = syncStore.profiles.find((entry) => entry.id === pid);
		if (!profile?.syncKey || isProfileReleased(pid))
			return { success: false, error: 'That workspace is not synced' };
		try {
			await relay.reauthenticate(identityFromSyncKey(profile.syncKey), turnstileToken);
			const cloud = await relaySync.read(profile, new AbortController().signal);
			const { snapshot, control } = cloud;
			if (!cloud.success || !snapshot || !control)
				throw new Error(
					cloud.error ?? 'Could not read cloud state before replacing the cloud copy'
				);
			const there = await this.land(
				pid,
				(current, signal) => {
					if (current.syncKey !== profile.syncKey)
						throw new Error('This workspace changed meanwhile. Try again.');
					return planRelayReplacement(pid, snapshot, control, signal);
				},
				// Boards and labels that returned under a new id are not the mirror's any
				// more, nor a save of the old ones still waiting to be tried again.
				{
					landed: () => {
						clearBoardsMirror(pid);
						notesStore.forgetUnsavedLabels(pid);
					}
				}
			);
			if (!there) return { success: false, error: 'That workspace is no longer on this device' };
		} catch (err) {
			if (pid === syncStore.activeId)
				notesStore.recordPersistenceError('Could not replace the cloud copy', err);
			else console.error('[notes] Could not replace the cloud copy', err);
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Could not replace the cloud copy'
			};
		}
		if (await syncScheduler.request(pid)) return { success: true };
		return {
			success: false,
			error: syncStore.stateOf(pid).issue?.message ?? 'Replacing the cloud copy did not finish'
		};
	}
}

export const workspaceRewrites = new WorkspaceRewrites();
