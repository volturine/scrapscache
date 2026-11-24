// A sync of one workspace, whichever window has it open or none. It reads what the
// workspace's database holds and saves what it pulled there: everything written on
// this device goes to the database straight away, so that is all there is to send,
// and the sync does not depend on which workspace a window shows. A window that has
// the workspace open is told what was saved and shows it. The fast-boot mirrors are
// left as they are: a load merges them with the database, where what was saved here
// is the newer copy.
import type { Label, Note } from '#lib/types.js';
import {
	deleteNote,
	getAllLabels,
	getAllNotesMetadata,
	getSyncOutboxKeys,
	getSyncState,
	hydrateNoteAttachments,
	mergeNote,
	mergeStoredLabels,
	mergeWorkspaceState
} from '#lib/db/idb.js';
import {
	settleAttachments,
	withAttachmentDecisions,
	type AttachmentDecisions
} from '#lib/attachmentSettling.js';
import { mergeStoredCanvasLibrary, readCanvasLibrary } from '#lib/canvasLibrary.js';
import { localWritesLanded } from '#lib/localWrites.js';
import { mergeKanbanBoards, normalizeBoards } from '#lib/kanban.js';
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
import { recordKey } from '#lib/syncRecords.js';
import {
	BOARD_IDB,
	BOARDS_IDB,
	LABEL_IDB,
	NOTE_IDB,
	newestTombstones,
	readStoredTombstones,
	sanitizeTombstones,
	type Tombstones
} from '#lib/syncTombstones.js';
import { reminderHistoryStore } from '#lib/stores/reminderHistory.js';
import type { SyncAccount } from '#lib/relayClient.js';
import { syncOutcome, type PulledRelayState, type SyncOutcome } from '#lib/relaySync.js';
import { relaySync, syncStore } from '#lib/stores/sync.svelte.js';

/** The later delete of each record, in what is stored or in what a sync pulled. */
const newest = (stored: Tombstones, pulled: unknown): Tombstones =>
	newestTombstones(stored, sanitizeTombstones(pulled));

/** Everything of a workspace that syncs, as its database holds it. Attachments come without bytes. */
export async function readWorkspace(pid: string): Promise<SyncSnapshot> {
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
		boards: mergeKanbanBoards([], normalizeBoards(boards), tombstones.boards),
		tombstones: tombstones.notes,
		labelTombstones: tombstones.labels,
		boardTombstones: tombstones.boards,
		libraryItems: library.entries,
		libraryTombstones: library.tombstones
	};
}

/** Told what a sync saved into the database, so a window showing the workspace can show it. */
export type SyncSaved = (snapshot: SyncSnapshot, decisions: AttachmentDecisions) => Promise<void>;

/**
 * The notes with the bytes a sync may have to send: of every attachment when the
 * relay has nothing of this device yet, and otherwise of the notes queued to upload.
 * Bytes that cannot be read are not sent: the attachment stays queued, and its note
 * is named in `unreadable`.
 */
async function withBytesToSend(
	pid: string,
	notes: Note[],
	everything: boolean,
	unreadable: Set<string>
): Promise<Note[]> {
	const queued = everything ? null : new Set(await getSyncOutboxKeys(pid));
	const loaded: Note[] = [];
	for (const note of notes) {
		const images = note.images ?? [];
		const wanted =
			images.length > 0 &&
			(queued === null ||
				queued.has(recordKey('note', note.id)) ||
				images.some((image) => queued.has(recordKey('attachment', image.id))));
		loaded.push(
			wanted
				? await hydrateNoteAttachments(pid, note).catch(() => {
						unreadable.add(note.id);
						return note;
					})
				: note
		);
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
	signal: AbortSignal,
	unreadable: Set<string>,
	saved: SyncSaved
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
		unreadable: (noteId) => unreadable.add(noteId)
	});
	// Given up for something that rewrites this workspace: nothing is saved.
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
						normalizeBoards(current[BOARDS_IDB]),
						snapshot.boards,
						boardTombstones
					)
				}
			};
		}
	);
	// What was deleted while the relay was waited for is deleted too.
	const deleted = state[NOTE_IDB];
	reminderHistoryStore.forgetNotes(pid, deleted);
	const notes: Note[] = [];
	for (const note of withoutTombstoned(settled.notes, deleted)) {
		const before = storedNotes.get(note.id);
		if (!settled.persist.has(note.id) && !noteNeedsDurableWrite(before, note)) {
			notes.push(note);
			continue;
		}
		// A window may have saved this note since it was read. The save takes its turn
		// among that note's saves, so it sees every one of them and merges the edit in.
		const kept = await mergeNote(pid, note, (now) => {
			// Deleted for good since it was read: the delete stands.
			if (now === undefined) return before === undefined ? note : null;
			return before === undefined || durableNoteSignature(now) !== durableNoteSignature(before)
				? withAttachmentDecisions(mergeTwoNotes(now, note), settled.decisions)
				: note;
		});
		if (kept) notes.push(kept);
	}
	for (const note of stored.notes) {
		if (deleted[note.id]) await deleteNote(pid, note.id);
	}
	// Labels are edited while a sync runs, by a window that has this workspace open.
	// They are merged with what is stored when they are written, never with what was
	// read before the relay was waited for.
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
	const result: SyncSnapshot = {
		notes,
		labels,
		boards: state[BOARDS_IDB],
		tombstones: state[NOTE_IDB],
		labelTombstones: state[LABEL_IDB],
		boardTombstones: state[BOARD_IDB],
		libraryItems: library.entries,
		libraryTombstones: library.tombstones
	};
	await saved(result, settled.decisions);
	return result;
}

/**
 * Sync a workspace from its database. Unless it settled with the relay, what it
 * owes is still queued. `saved` hears what was saved, each time something is.
 */
export async function syncWorkspace(
	profile: StoredProfile,
	signal: AbortSignal,
	saved: SyncSaved = async () => undefined
): Promise<SyncOutcome> {
	const pid = profile.id;
	const account = identityFromSyncKey(profile.syncKey);
	const unreadable = new Set<string>();
	// A relay that was reset asks for this device's whole copy: one more pass sends it.
	for (let pass = 0; pass < 2; pass += 1) {
		await localWritesLanded(pid);
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
				everything,
				unreadable
			),
			labels: withoutTombstoned(stored.labels, stored.labelTombstones)
		};
		if (signal.aborted) return 'failed';
		const result = await relaySync.sync(
			profile,
			local,
			(snapshot, _pid, pulled) =>
				saveToWorkspace(snapshot, pid, account, pulled, signal, unreadable, saved),
			signal
		);
		if (!result.success) return syncOutcome(result);
		if (result.bootstrap) continue;
		syncStore.attachmentsUnreadable(pid, unreadable.size > 0);
		return 'synced';
	}
	return 'synced';
}
