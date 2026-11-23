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
	getStoredAttachmentVersions,
	getSyncOutboxKeys,
	getSyncState,
	hydrateNoteAttachments,
	mergeNote,
	mergeStoredLabels,
	mergeWorkspaceState,
	uploadGeneration,
	type RewritePlan
} from '#lib/db/idb.js';
import {
	settleAttachments,
	withAttachmentDecisions,
	type AttachmentDecisions
} from '#lib/attachmentSettling.js';
import {
	CANVAS_LIBRARY_STATE_KEY,
	CANVAS_LIBRARY_TOMBSTONES_KEY,
	mergeStoredCanvasLibrary,
	readCanvasLibrary
} from '#lib/canvasLibrary.js';
import { editContext } from '#lib/editContext.js';
import { localWritesLanded } from '#lib/localWrites.js';
import { mergeKanbanBoards, normalizeBoards } from '#lib/kanban.js';
import {
	isTombstoned,
	mergeLabelLists,
	mergeNoteLists,
	mergeTwoNotes,
	withoutTombstoned
} from '#lib/model/index.js';
import { durableNoteSignature, noteNeedsDurableWrite } from '#lib/noteStorage.js';
import type { StoredProfile } from '#lib/profiles.js';
import { currentRecordKeys, syncControlKeys } from '#lib/syncEngine.js';
import { buildForcePushSnapshot } from '#lib/syncForcePush.js';
import { identityFromSyncKey } from '#lib/syncPairing.js';
import type { SyncSnapshot } from '#lib/syncRecords.js';
import { recordKey } from '#lib/syncRecords.js';
import { withinTime } from '#lib/syncRetry.js';
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

/** A save landed in the workspace between a plan reading it and the plan landing. */
export class WorkspaceChanged extends Error {}

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
export async function planRelayReplacement(
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
