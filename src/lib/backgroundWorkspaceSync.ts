// Sync for a workspace that is not open in this window. A workspace left with
// changes still to send must not wait to be opened again, so its sync runs from
// what its database holds and saves there. The in-memory stores belong to the open
// workspace and take no part. The fast-boot mirrors are left as they are: a load
// merges them with the database, where what was saved here is the newer copy.
import type { Label, Note } from '#lib/types.js';
import {
	deleteNote,
	getAllLabels,
	getAllNotesMetadata,
	getNote,
	getSyncOutboxKeys,
	getSyncState,
	hydrateNoteAttachments,
	mergeStoredLabels,
	mergeWorkspaceState,
	putNote
} from '#lib/db/idb.js';
import { settleAttachments, withAttachmentDecisions } from '#lib/attachmentSettling.js';
import { mergeStoredCanvasLibrary, readCanvasLibrary } from '#lib/canvasLibrary.js';
import { mergeKanbanBoards, normalizeBoard, type KanbanBoard } from '#lib/kanban.js';
import {
	mergeLabelLists,
	mergeNoteLists,
	mergeTwoNotes,
	withoutTombstoned
} from '#lib/model/index.js';
import { durableNoteSignature, noteNeedsDurableWrite } from '#lib/noteStorage.js';
import type { StoredProfile } from '#lib/profiles.js';
import { syncControlKeys } from '#lib/syncEngine.js';
import { identityFromSyncKey } from '#lib/syncPairing.js';
import type { SyncSnapshot } from '#lib/syncRecords.js';
import {
	BOARD_IDB,
	BOARDS_IDB,
	LABEL_IDB,
	NOTE_IDB,
	readStoredTombstones,
	sanitizeTombstones,
	type Tombstones
} from '#lib/syncTombstones.js';
import { reminderHistoryStore } from '#lib/stores/reminderHistory.js';
import {
	syncOutcome,
	syncStore,
	type PulledRelayState,
	type SyncAccount,
	type SyncOutcome
} from '#lib/stores/sync.svelte.js';

function storedBoards(value: unknown): KanbanBoard[] {
	return Array.isArray(value)
		? value.flatMap((board): KanbanBoard[] => {
				const normalized = normalizeBoard(board);
				return normalized ? [normalized] : [];
			})
		: [];
}

function newest(stored: Tombstones, pulled: Record<string, number>): Tombstones {
	const merged = { ...stored };
	for (const [id, deletedAt] of Object.entries(sanitizeTombstones(pulled))) {
		if (deletedAt > (merged[id] || 0)) merged[id] = deletedAt;
	}
	return merged;
}

/** Everything of a workspace that syncs, as its database holds it. Attachments come without bytes. */
async function readWorkspace(pid: string): Promise<SyncSnapshot> {
	const [notes, labels, tombstones, boards, library] = await Promise.all([
		getAllNotesMetadata(pid),
		getAllLabels(pid),
		readStoredTombstones(pid),
		getSyncState<unknown>(pid, BOARDS_IDB),
		readCanvasLibrary(pid)
	]);
	return {
		notes,
		labels,
		boards: mergeKanbanBoards([], storedBoards(boards), tombstones.boards),
		tombstones: tombstones.notes,
		labelTombstones: tombstones.labels,
		boardTombstones: tombstones.boards,
		libraryItems: library.entries,
		libraryTombstones: library.tombstones
	};
}

/**
 * The notes with the bytes a sync may have to send: of every attachment when the
 * relay has nothing of this device yet, and otherwise of the notes queued to upload.
 */
async function withBytesToSend(pid: string, notes: Note[], everything: boolean): Promise<Note[]> {
	const queued = everything ? null : new Set(await getSyncOutboxKeys(pid));
	const loaded: Note[] = [];
	for (const note of notes) {
		const images = note.images ?? [];
		const wanted =
			images.length > 0 &&
			(queued === null ||
				queued.has(`note:${note.id}`) ||
				images.some((image) => queued.has(`attachment:${image.id}`)));
		// Bytes that cannot be read are not sent: the attachment stays queued.
		loaded.push(wanted ? await hydrateNoteAttachments(pid, note).catch(() => note) : note);
	}
	return loaded;
}

/**
 * Save what a sync pulled into the workspace's database. Every merge reads what
 * is stored at that moment, so an edit another window saves meanwhile is kept. The
 * cursor is committed only after this returns: a sync cut short reads it all again.
 */
async function saveToWorkspace(
	snapshot: SyncSnapshot,
	pid: string,
	account: SyncAccount,
	pulled: PulledRelayState,
	signal: AbortSignal
): Promise<SyncSnapshot> {
	const stored = await readWorkspace(pid);
	const tombstones = newest(stored.tombstones, snapshot.tombstones);
	const labelTombstones = newest(stored.labelTombstones, snapshot.labelTombstones);
	const storedNotes = new Map(stored.notes.map((note) => [note.id, note]));
	const settled = await settleAttachments({
		notes: withoutTombstoned(mergeNoteLists(stored.notes, snapshot.notes), tombstones),
		pid,
		account,
		relay: pulled,
		signal,
		unreadable: () => undefined
	});
	// Given up for a handover or for the open workspace's sync: nothing is saved.
	if (signal.aborted) return snapshot;
	// Deletes are saved first: a note saved before its delete would outlive a crash.
	const state = await mergeWorkspaceState(
		pid,
		[NOTE_IDB, LABEL_IDB, BOARD_IDB, BOARDS_IDB],
		(current) => {
			const boardTombstones = newest(
				sanitizeTombstones(current[BOARD_IDB]),
				snapshot.boardTombstones
			);
			return {
				value: {
					[NOTE_IDB]: newest(sanitizeTombstones(current[NOTE_IDB]), tombstones),
					[LABEL_IDB]: newest(sanitizeTombstones(current[LABEL_IDB]), labelTombstones),
					[BOARD_IDB]: boardTombstones,
					[BOARDS_IDB]: mergeKanbanBoards(
						storedBoards(current[BOARDS_IDB]),
						snapshot.boards,
						boardTombstones
					)
				}
			};
		}
	);
	reminderHistoryStore.forgetNotes(pid, tombstones);
	const notes: Note[] = [];
	for (const note of settled.notes) {
		const before = storedNotes.get(note.id);
		if (!settled.persist.has(note.id) && !noteNeedsDurableWrite(before, note)) {
			notes.push(note);
			continue;
		}
		// Another window may have saved this note since it was read; its edit is merged in.
		const now = await getNote(pid, note.id);
		const edited =
			now !== undefined &&
			(before === undefined || durableNoteSignature(now) !== durableNoteSignature(before));
		const saved = edited
			? withAttachmentDecisions(mergeTwoNotes(now, note), settled.decisions)
			: note;
		await putNote(pid, saved);
		notes.push(saved);
	}
	for (const note of stored.notes) {
		if (tombstones[note.id]) await deleteNote(pid, note.id);
	}
	// Labels are edited without the sync lock, by a window that has this workspace
	// open. They are merged with what is stored when they are written, never with
	// what was read before the relay was waited for.
	const labels: Label[] = await mergeStoredLabels(pid, LABEL_IDB, (current, deleted) =>
		withoutTombstoned(
			mergeLabelLists(current, snapshot.labels),
			newest(sanitizeTombstones(deleted), labelTombstones)
		)
	);
	const library = await mergeStoredCanvasLibrary(
		pid,
		snapshot.libraryItems,
		snapshot.libraryTombstones
	);
	await reminderHistoryStore.waitForPendingWrites();
	return {
		notes,
		labels,
		boards: state[BOARDS_IDB],
		tombstones: state[NOTE_IDB],
		labelTombstones: state[LABEL_IDB],
		boardTombstones: state[BOARD_IDB],
		libraryItems: library.entries,
		libraryTombstones: library.tombstones
	};
}

/**
 * Sync a workspace that is not open in this window from its database. Unless it
 * settled with the relay, what it owes is still queued.
 */
export async function syncWorkspaceFromDevice(
	profile: StoredProfile,
	signal: AbortSignal
): Promise<SyncOutcome> {
	const pid = profile.id;
	const account = identityFromSyncKey(profile.syncKey);
	// A relay that was reset asks for this device's whole copy: one more pass sends it.
	for (let pass = 0; pass < 2; pass += 1) {
		const baseline = await getSyncState<Record<string, string>>(
			pid,
			syncControlKeys(account.accountId).baseline
		).catch(() => undefined);
		const everything = pass > 0 || !baseline || Object.keys(baseline).length === 0;
		const stored = await readWorkspace(pid);
		const local: SyncSnapshot = {
			...stored,
			notes: await withBytesToSend(
				pid,
				withoutTombstoned(stored.notes, stored.tombstones),
				everything
			),
			labels: withoutTombstoned(stored.labels, stored.labelTombstones)
		};
		if (signal.aborted) return 'failed';
		const result = await syncStore.syncInBackground(
			profile,
			local,
			(snapshot, _pid, pulled) => saveToWorkspace(snapshot, pid, account, pulled, signal),
			signal
		);
		if (!result.success || !result.bootstrap) return syncOutcome(result);
	}
	return 'synced';
}
