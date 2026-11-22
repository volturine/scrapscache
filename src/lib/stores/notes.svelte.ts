// Rune-based notes & labels store. Persists to IndexedDB from explicit write paths.
import type { Note, Label, NoteColor, NoteImage } from '#lib/types.js';
import { activeFilterCount, matchesFilters, NO_FILTERS, type SearchFilters } from '#lib/search.js';
import {
	getAllNotesMetadata,
	getStoredAttachmentVersions,
	holdAttachmentWrites,
	hydrateNoteAttachments,
	putNote,
	deleteNote,
	getAllLabels,
	putLabel,
	deleteLabel,
	bulkPutNotes,
	bulkPutLabels,
	clearAllNotes,
	clearAllLabels,
	replaceAllDeviceData,
	getSyncOutboxKeys,
	clearSyncOutbox,
	markSyncOutbox,
	pruneOrphanImageBlobs,
	isProfileReleased,
	rewriteWorkspace,
	waitForDeviceWrites
} from '#lib/db/idb.js';
import {
	applyNoteEdit,
	mergeLabelLists,
	mergeNoteLists,
	mergeTwoNotes,
	reminderShownAt,
	retargetLocalNotes,
	stampNewNote,
	uid,
	withoutTombstoned,
	type NotePatch,
	type ReminderRepeat
} from '#lib/model/index.js';
import { editContext, syncClock } from '#lib/editContext.js';
import { mergeHydratedImages } from '#lib/noteAttachmentHydration.js';
import {
	attachmentDecisionKey,
	withAttachmentDecisions,
	type AttachmentDecisions
} from '#lib/attachmentSettling.js';
import { AttachmentHydrationQueue } from '#lib/attachmentHydrationQueue.js';
import { syncStore } from '#lib/stores/sync.svelte.js';
import { clearBoardsMirror, kanbanStore } from '#lib/stores/kanban.svelte.js';
import { actionUndo } from '#lib/stores/actionUndo.svelte.js';
import { composerStore } from '#lib/stores/composer.svelte.js';
import { canvasLibraryStore } from '#lib/stores/canvasLibrary.js';
import { reminderHistoryStore } from '#lib/stores/reminderHistory.js';
import { syncSnapshot, type SyncSnapshot } from '#lib/syncRecords.js';
import { uiStore } from '#lib/stores/ui.svelte.js';
import { trashPurgeAt, cloneNote } from '#lib/utils.js';
import { appClock } from '#lib/appClock.svelte.js';
import { noteAttachments, toggleLineAt } from '#lib/checklistBody.js';
import { bodyHasPhotoMarker, parsePhotoMarker, stripPhotoMarkers } from '#lib/photoMarker.js';
import { joinWrappedHttpUrls } from '#lib/linkPreview.js';
import {
	journalPendingNotes,
	durableNoteSignature,
	noteForLocalStorage,
	noteNeedsDurableWrite,
	readLabelsMirror,
	readNotesMirror,
	readPendingNotes,
	settlePendingNotes,
	writeLabelsMirror,
	writeNotesMirror,
	type PendingNotes
} from '#lib/noteStorage.js';
import {
	addTombstones,
	adoptTombstones,
	hydrateTombstones,
	newestTombstones,
	deleteLabelWithTombstone,
	readStoredTombstones,
	resetTombstoneCaches,
	readLabelTombstones,
	readTombstones,
	writeLabelTombstones,
	writeTombstones
} from '#lib/syncTombstones.js';
import {
	ensureAttachmentPreview,
	fileToNoteImage,
	prepareAttachmentForMemory,
	stripFullPreviewBytes
} from '#lib/noteImages.js';
import { isCanvasAttachment } from '#lib/canvasAttachment.js';
import { replacementFitsStorage } from '#lib/storageCapacity.js';
import { formatStorageError } from '#lib/imageBlob.js';
import {
	BackupImportMode,
	importedReminderHistory,
	prepareImportedNotes,
	type ScrapsCacheBackup
} from '#lib/backup.js';
import { stableStringify } from '#lib/model/index.js';
import { loadLazyModule } from '#lib/staleModuleReload.js';
import { buildForcePushSnapshot } from '#lib/syncForcePush.js';
import { currentRecordKeys, noteRecordKeys } from '#lib/syncEngine.js';
import { planBackupImport, planKeepImport, type ImportPlan } from '#lib/workspaceImport.js';
import { identityFromSyncKey } from '#lib/syncPairing.js';
import { CAUGHT_UP_MS, syncScheduler } from '#lib/stores/syncScheduler.js';
import { withWorkspaceLock } from '#lib/webLock.js';
import { syncWorkspace } from '#lib/workspaceSync.js';

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

/** What deleting a label with its notes changes on each note. */
type NoteTrashState = Pick<Note, 'id' | 'trashed' | 'trashedAt' | 'pinned' | 'archived'>;

export { noteNeedsDurableWrite };

/** How long edits must pause before the fast-boot mirror catches up. */
const MIRROR_DELAY_MS = 2_000;

/** True when closing the editor should throw the note away. */
export function noteIsBlank(note: Note): boolean {
	return (
		!note.title.trim() &&
		!(note.body ?? '').trim() &&
		note.reminder == null &&
		!noteAttachments(note).some(
			(attachment) =>
				attachment.dataUrl.length > 0 || !!attachment.thumbUrl || !!attachment.contentHash
		)
	);
}

export class NotesStore {
	/** The namespace this window currently reads and writes. */
	private get pid(): string {
		return syncStore.activePid;
	}

	/** True while a sync of the open workspace (auto or manual) is under way. */
	get syncing(): boolean {
		return syncScheduler.syncing(this.pid);
	}
	notes = $state<Note[]>([]);
	labels = $state<Label[]>([]);
	loaded = $state(false);
	lastPersistError = $state<string | null>(null);
	/** True while a backup or Keep import this window started is running. Nothing waits for it. */
	importing = $state(false);
	deletedNoteIds = $state<Record<string, number>>(readTombstones());
	deletedLabelIds = $state<Record<string, number>>(readLabelTombstones());
	private attachmentLoads = new Map<string, Promise<void>>();
	private attachmentWork = new Set<Promise<void>>();
	private attachmentPass: Promise<void> | null = null;
	/** Settles once the load under way has ended. A sync's result waits for it. */
	private boot: Promise<void> = Promise.resolve();
	private visibleAttachmentQueue = new AttachmentHydrationQueue((noteId) =>
		this.ensureNoteAttachments(noteId)
	);
	/** Called after cloud notes replace local state. Used to refresh reminder wakes. */
	onAfterSync: (() => void) | null = null;
	/** Refreshes profile-dependent services after local state changes namespace. */
	onProfileReload: ((pid: string, notes: Note[]) => void | Promise<void>) | null = null;

	constructor() {
		this.notes = readNotesMirror(this.pid);
		this.labels = readLabelsMirror(this.pid);
		syncStore.onLocalDataChange = () => this.scheduleSyncPush();
		syncScheduler.onSynced = (pid, saved) =>
			saved ? this.showSynced(pid, saved.snapshot, saved.decisions) : this.otherWindowSynced(pid);
		if (this.notes.length > 0) this.loaded = true;
		if (typeof window !== 'undefined') {
			window.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'hidden') this.mirrorToLS();
				else if (this.staleWhileHidden === this.pid) void this.rehydrateFromIDB();
			});
			window.addEventListener('pagehide', () => this.mirrorToLS());
		}
	}

	// Derived collections -------------------------------------------------
	labelsById = $derived(new Map(this.labels.map((label) => [label.id, label])));
	/** Out of the archive and trash, and not the note the composer is still writing. */
	activeNotes = $derived(
		this.notes.filter((n) => !n.archived && !n.trashed && n.id !== composerStore.draftId)
	);
	pinnedNotes = $derived(this.activeNotes.filter((n) => n.pinned));
	unpinnedNotes = $derived(this.activeNotes.filter((n) => !n.pinned));
	archivedNotes = $derived(this.notes.filter((n) => n.archived && !n.trashed));
	trashedNotes = $derived(this.notes.filter((n) => n.trashed));
	/** Soonest first; a repeating reminder by its next time, so the order moves on as times come. */
	notesWithReminders = $derived.by(() => {
		const now = appClock.now;
		return this.activeNotes
			.filter((n) => n.reminder != null)
			.map((n) => ({ note: n, at: reminderShownAt(n, now) ?? 0 }))
			.sort((a, b) => a.at - b.at)
			.map(({ note }) => note);
	});

	// --- Lifecycle -------------------------------------------------------
	async init() {
		let booted: () => void = () => undefined;
		this.boot = new Promise((resolve) => (booted = resolve));
		try {
			await this.load();
		} finally {
			booted();
		}
	}

	private async load() {
		this.staleWhileHidden = null;
		await syncStore.ensureProfilesLoaded();

		// One read of the journal: these are the entries this boot replays, so only
		// these may be settled. Another window may journal more while this awaits.
		const pending = readPendingNotes(this.pid);
		const mirrorNotes = readNotesMirror(this.pid, pending);
		const mirrorLabels = readLabelsMirror(this.pid);
		let dbNotes: Note[] = [];
		let dbLabels: Label[] = [];
		let deviceReadFailed = false;
		try {
			[dbNotes, dbLabels] = await Promise.all([
				getAllNotesMetadata(this.pid),
				getAllLabels(this.pid)
			]);
		} catch (err) {
			deviceReadFailed = true;
			this.recordPersistenceError('Could not read IndexedDB', err);
		}

		const notes = mergeNoteLists(mirrorNotes, dbNotes).sort((a, b) => b.updatedAt - a.updatedAt);
		const labels = mergeLabelLists(mirrorLabels, dbLabels).sort((a, b) =>
			a.name.localeCompare(b.name)
		);
		const seededFlag =
			typeof localStorage !== 'undefined' ? localStorage.getItem('scrapscache-seeded') : null;

		const tombstones = await hydrateTombstones(this.pid).catch(() => ({
			notes: this.deletedNoteIds,
			labels: this.deletedLabelIds,
			boards: {}
		}));
		this.deletedNoteIds = tombstones.notes;
		this.deletedLabelIds = tombstones.labels;
		// The boards hydrate from their mirror even when the device store cannot be
		// read; the rest of the boot must still run, or reminders, the first sync
		// and note links never start.
		try {
			const loading = this.pid;
			await kanbanStore.hydrateFromDevice(loading, tombstones.boards, () => loading === this.pid);
		} catch (err) {
			this.recordPersistenceError('Could not read the boards from IndexedDB', err);
		}
		// Loaded before any sync reads them: a sync treats what is missing here as gone.
		await Promise.all([
			canvasLibraryStore.hydrate(this.pid),
			reminderHistoryStore.hydrate(this.pid)
		]).catch((err) =>
			this.recordPersistenceError('Could not read the canvas library or reminder history', err)
		);

		if (
			notes.length === 0 &&
			labels.length === 0 &&
			// Starter notes greet a device once, in its first workspace.
			!seededFlag &&
			!syncStore.isLoggedIn
		) {
			localStorage?.setItem('scrapscache-seeded', '1');
			this.notes = this.seedNotes();
			this.labels = [];
			this.mirrorToLS();
			try {
				await bulkPutNotes(this.pid, this.notes);
			} catch (err) {
				this.recordPersistenceError('Could not save starter notes', err);
			}
		} else {
			this.notes = withoutTombstoned(notes, this.deletedNoteIds);
			this.labels = withoutTombstoned(labels, this.deletedLabelIds);
			this.mirrorToLS();
			if (!deviceReadFailed) {
				try {
					await this.recoverMirrorIntoIndexedDB(dbNotes, dbLabels);
					// Every edit journaled before this boot read the journal is in IndexedDB now.
					settlePendingNotes(pending, this.pid);
				} catch (err) {
					this.recordPersistenceError('Could not restore IndexedDB from mirror', err);
				}
			}
			// A synced workspace settles its attachments against the relay, at each sync.
			if (!deviceReadFailed && !syncStore.isLoggedIn) {
				await this.settleAttachmentsWithoutRelay().catch((err) =>
					this.recordPersistenceError('Could not settle attachments', err)
				);
			}
			pruneOrphanImageBlobs(this.pid).catch((err) =>
				this.recordPersistenceError('Could not reclaim unused photo storage', err)
			);
		}
		await this.dropAbandonedDraft();
		this.purgeOldTrash();
		this.loaded = true;
		// Every workspace catches up, not only this one: one left behind may still owe
		// the relay something, and other devices may have changed any of them.
		void syncScheduler.catchUpAll();
	}

	/**
	 * Another window saved what it synced. The browser may freeze a hidden window in
	 * the middle of re-reading it, and its open transactions then hold every other
	 * window's writes to this workspace until it thaws. A hidden window has nothing to
	 * show, so it catches up once it is shown again, or when a sync of its own lands.
	 */
	private otherWindowSynced(pid: string): void {
		if (pid !== this.pid) return;
		if (document.visibilityState === 'hidden') this.staleWhileHidden = this.pid;
		else void this.rehydrateFromIDB();
	}

	private async rehydrateFromIDB() {
		this.staleWhileHidden = null;
		const pid = this.pid;
		try {
			const [dbNotes, dbLabels, stored] = await Promise.all([
				getAllNotesMetadata(pid),
				getAllLabels(pid),
				readStoredTombstones(pid)
			]);
			if (pid !== this.pid) return;
			// What the other window saved may delete notes this one still shows.
			const newest = (held: Record<string, number>, saved: Record<string, number>) => {
				const merged = { ...held };
				for (const [id, at] of Object.entries(saved)) if (at > (merged[id] || 0)) merged[id] = at;
				return merged;
			};
			this.deletedNoteIds = newest(this.deletedNoteIds, stored.notes);
			this.deletedLabelIds = newest(this.deletedLabelIds, stored.labels);
			// The boards are saved whole from memory, so memory has to hold what was saved.
			await kanbanStore.hydrateFromDevice(pid, stored.boards, () => pid === this.pid);
			if (pid !== this.pid) return;
			const mirrorNotes = readNotesMirror(this.pid);
			const mirrorLabels = readLabelsMirror(this.pid);
			this.notes = withoutTombstoned(
				mergeNoteLists(mirrorNotes, dbNotes),
				this.deletedNoteIds
			).sort((a, b) => b.updatedAt - a.updatedAt);
			this.labels = withoutTombstoned(
				mergeLabelLists(mirrorLabels, dbLabels),
				this.deletedLabelIds
			).sort((a, b) => a.name.localeCompare(b.name));
			this.mirrorToLS();
			await Promise.all([
				canvasLibraryStore.hydrate(this.pid),
				reminderHistoryStore.hydrate(this.pid)
			]);
		} catch (err) {
			this.recordPersistenceError('Could not rehydrate from IndexedDB', err);
		}
	}

	/** Fill a note's attachment placeholders without blocking the initial note render. */
	async ensureNoteAttachments(noteId: string): Promise<void> {
		const existing = this.notes.find((note) => note.id === noteId);
		if (!existing || !(existing.images ?? []).some((image) => !image.dataUrl)) return;
		const pending = this.attachmentLoads.get(noteId);
		if (pending) return pending;

		const source = cloneNote(existing);
		const load = hydrateNoteAttachments(this.pid, source)
			.then(async (hydrated) => {
				const index = this.notes.findIndex((note) => note.id === noteId);
				if (index === -1) return;
				const current = this.notes[index];
				const images = await Promise.all(
					mergeHydratedImages(current.images ?? [], hydrated.images ?? []).map(
						ensureAttachmentPreview
					)
				);
				if (images.some((image, imageIndex) => image !== current.images?.[imageIndex])) {
					this.notes[index] = { ...current, images };
				}
			})
			.catch((err) => {
				this.recordPersistenceError(`Could not load attachments for note ${noteId}`, err);
			});
		this.attachmentLoads.set(noteId, load);
		return load.finally(() => {
			if (this.attachmentLoads.get(noteId) === load) this.attachmentLoads.delete(noteId);
		});
	}

	/** Explicit full hydration for sync, bounded to two complete notes at a time. */
	private hydrateAllAttachments(): Promise<void> {
		if (this.attachmentPass) return this.attachmentPass;
		const ids = this.notes
			.filter((note) => (note.images ?? []).some((image) => !image.dataUrl))
			.map((note) => note.id);
		if (ids.length === 0) return Promise.resolve();

		let next = 0;
		const worker = async () => {
			while (next < ids.length) {
				const noteId = ids[next++];
				await this.ensureNoteAttachments(noteId);
			}
		};
		this.attachmentPass = Promise.all(Array.from({ length: Math.min(2, ids.length) }, worker))
			.then(() => undefined)
			.finally(() => {
				this.attachmentPass = null;
			});
		return this.attachmentPass;
	}

	/**
	 * A workspace that does not sync has no relay to ask: the bytes this device holds
	 * are all there is of an attachment. A note listing another version lists the
	 * one held, and a note listing bytes that were never saved stops listing them.
	 */
	private async settleAttachmentsWithoutRelay(): Promise<void> {
		const pid = this.pid;
		const stored = await getStoredAttachmentVersions(pid);
		const decisions: AttachmentDecisions = new Map();
		for (const note of this.notes) {
			for (const listed of note.images ?? []) {
				if (listed.dataUrl) continue;
				const held = stored.get(`${note.id}::${listed.id}`);
				if (held !== undefined && held === listed.contentHash) continue;
				const { editedAt: _edit, ...kept } = listed;
				decisions.set(
					attachmentDecisionKey(note.id, listed),
					held === undefined ? null : { ...kept, contentHash: held }
				);
			}
		}
		if (decisions.size === 0 || pid !== this.pid) return;
		for (const [index, note] of this.notes.entries()) {
			const settled = withAttachmentDecisions(note, decisions);
			if (settled === note) continue;
			this.notes[index] = settled;
			await putNote(pid, settled, noteRecordKeys(settled));
		}
		this.scheduleMirror();
	}

	/** Queue attachment bytes only when a note card enters the viewport. */
	requestVisibleNoteAttachments(noteId: string): void {
		const note = this.notes.find((item) => item.id === noteId);
		if (!note) return;
		// Prefer thumbs on cards. Only hydrate full blobs when a photo has no thumb at all
		// or a non-image file still lacks bytes.
		const needs = (note.images ?? []).some((image) => {
			const mime = (image.mime || '').toLowerCase();
			if (
				(mime.startsWith('image/') && !mime.includes('dng') && mime !== 'image/tiff') ||
				isCanvasAttachment(image)
			) {
				return !image.thumbUrl && !image.dataUrl;
			}
			return !image.dataUrl;
		});
		if (!needs) return;
		this.visibleAttachmentQueue.enqueue(noteId);
	}

	/** Apply an edit and wait until it is durable on this device. */
	async flushNote(id: string, patch: NotePatch = {}): Promise<void> {
		const idx = this.notes.findIndex((x) => x.id === id);
		if (idx === -1) return;
		this.notes[idx] = applyNoteEdit(this.notes[idx], patch, editContext);
		const note = this.notes[idx];
		const pid = this.pid;
		const bytesLanded = this.holdWhileBytesLand(pid, note);
		this.journal([note]);
		this.scheduleMirror();
		try {
			await putNote(pid, note, noteRecordKeys(note));
			settlePendingNotes({ [note.id]: noteForLocalStorage(note) }, pid);
			this.lastPersistError = null;
			this.scheduleSyncPush();
			bytesLanded();
		} catch (err) {
			this.recordPersistenceError(`Could not save note ${id}`, err);
			this.scheduleNoteRetry(id, bytesLanded);
			throw err;
		}
	}

	async discardIfEmpty(id: string): Promise<void> {
		const n = this.notes.find((x) => x.id === id);
		if (!n || !noteIsBlank(n)) return;
		// Called as a bar or sheet closes, with nothing waiting on it: a workspace
		// that went away meanwhile is recorded, not thrown past every handler.
		try {
			await this.deleteNoteForever(id);
		} catch (err) {
			this.recordPersistenceError('Could not drop an empty note', err);
		}
	}

	/**
	 * The bar's draft from a window that went away mid-write (see
	 * `composerStore.abandonedDraft`): dropped if nothing was written into it,
	 * kept otherwise. A draft of another workspace is left for that one's load.
	 */
	private async dropAbandonedDraft(): Promise<void> {
		const id = composerStore.abandonedDraft();
		if (!id || !this.notes.some((n) => n.id === id)) return;
		composerStore.forgetAbandonedDraft(id);
		await this.discardIfEmpty(id);
	}

	/** Delete trashed notes whose purge time has come (trashPurgeAt, which the countdown shows). */
	purgeOldTrash() {
		const now = Date.now();
		const ids = this.notes
			.filter((n) => n.trashed && trashPurgeAt(n.trashedAt) <= now)
			.map((n) => n.id);
		if (ids.length === 0) return;
		void this.persistDeletedNotes(ids).catch((err) =>
			this.recordPersistenceError('Could not purge expired trash', err)
		);
	}

	// --- CRUD ------------------------------------------------------------
	createNote(partial: Partial<Note> = {}): Note {
		const now = syncClock.now();
		const created: Note = {
			id: uid(),
			title: partial.title ?? '',
			body: partial.body ?? '',
			color: partial.color ?? 'default',
			pinned: partial.pinned ?? false,
			archived: false,
			trashed: false,
			trashedAt: null,
			...(partial.secret ? { secret: true } : {}),
			createdAt: now,
			updatedAt: now,
			reminder: partial.reminder ?? null,
			labels: [...(partial.labels ?? [])],
			images: (partial.images ?? []).map((image) => ({ ...image })),
			...(partial.linkPreviews?.length
				? { linkPreviews: partial.linkPreviews.map((preview) => ({ ...preview })) }
				: {})
		};
		const note = stampNewNote(created, editContext.writer);
		this.notes = [note, ...this.notes];
		this.persist(note.id);
		return note;
	}

	/** Edits are stamped field by field; a patch that changes nothing writes nothing. */
	updateNote(id: string, patch: NotePatch): void {
		const idx = this.notes.findIndex((n) => n.id === id);
		if (idx === -1) return;
		const current = this.notes[idx];
		const next = applyNoteEdit(current, patch, editContext);
		if (next === current) return;
		this.notes[idx] = next;
		this.persist(id);
	}

	togglePin(id: string): void {
		const n = this.notes.find((x) => x.id === id);
		if (!n) return;
		this.updateNote(id, { pinned: !n.pinned });
	}

	toggleArchive(id: string): void {
		const n = this.notes.find((x) => x.id === id);
		if (!n) return;
		const before = { archived: n.archived, pinned: n.pinned };
		const after = { archived: !n.archived, pinned: false };
		this.updateNote(id, after);
		// Unarchiving is undone by archiving again; archiving takes the note out of view.
		if (after.archived) this.rememberFields(id, 'Note archived', before, after);
	}

	toggleSecret(id: string): void {
		const n = this.notes.find((x) => x.id === id);
		if (!n) return;
		this.updateNote(id, { secret: !n.secret });
	}

	setColor(id: string, color: NoteColor): void {
		this.updateNote(id, { color });
	}

	setReminder(id: string, reminder: number | null, repeat: ReminderRepeat | null = null): void {
		this.updateNote(id, { reminder, repeat: repeat ?? undefined });
	}

	/** Toggle `[ ]` / `[x]` line in unified body text. */
	toggleBodyChecklistLine(noteId: string, lineIndex: number): void {
		const n = this.notes.find((x) => x.id === noteId);
		if (!n) return;
		const body = toggleLineAt(n.body ?? '', lineIndex);
		this.updateNote(noteId, { body });
	}

	toggleLabel(noteId: string, labelId: string): void {
		const n = this.notes.find((x) => x.id === noteId);
		if (!n) return;
		const labels = n.labels.includes(labelId)
			? n.labels.filter((l) => l !== labelId)
			: [...n.labels, labelId];
		this.updateNote(noteId, { labels });
	}

	// Many at once ---------------------------------------------------------
	/** "2 notes archived": one step on the undo bar for the whole selection. */
	private static many(count: number, did: string): string {
		return `${count} ${count === 1 ? 'note' : 'notes'} ${did}`;
	}

	private present(ids: readonly string[]): Note[] {
		const wanted = new Set(ids);
		return this.notes.filter((note) => wanted.has(note.id));
	}

	/**
	 * Apply `after` to every note and remember each one's `before` under one undo
	 * step, whose message counts the notes that changed.
	 */
	private changeMany(
		ids: readonly string[],
		did: string,
		fields: (note: Note) => { before: NotePatch; after: NotePatch } | null
	): void {
		const changes = this.present(ids).flatMap((note) => {
			const change = fields(note);
			return change ? [{ id: note.id, ...change }] : [];
		});
		if (changes.length === 0) return;
		for (const change of changes) this.updateNote(change.id, change.after);
		actionUndo.push({
			message: NotesStore.many(changes.length, did),
			noteIds: changes.map((change) => change.id),
			undo: () => {
				for (const change of changes) this.updateNote(change.id, change.before);
			},
			redo: () => {
				for (const change of changes) this.updateNote(change.id, change.after);
			}
		});
	}

	archiveNotes(ids: readonly string[]): void {
		this.changeMany(ids, 'archived', (note) =>
			note.archived
				? null
				: {
						before: { archived: false, pinned: note.pinned },
						after: { archived: true, pinned: false }
					}
		);
	}

	trashNotes(ids: readonly string[]): void {
		this.changeMany(ids, 'moved to trash', (note) =>
			note.trashed
				? null
				: {
						before: { trashed: false, trashedAt: note.trashedAt, pinned: note.pinned },
						after: { trashed: true, trashedAt: Date.now(), pinned: false }
					}
		);
	}

	/** Back to Notes from the archive or the trash. */
	restoreNotes(ids: readonly string[]): void {
		this.changeMany(ids, 'restored', (note) =>
			!note.archived && !note.trashed
				? null
				: {
						before: { archived: note.archived, trashed: note.trashed, trashedAt: note.trashedAt },
						after: { archived: false, trashed: false, trashedAt: null }
					}
		);
	}

	pinNotes(ids: readonly string[], pinned: boolean): void {
		for (const note of this.present(ids)) {
			if (note.pinned !== pinned) this.updateNote(note.id, { pinned });
		}
	}

	setColorMany(ids: readonly string[], color: NoteColor): void {
		for (const note of this.present(ids)) {
			if (note.color !== color) this.updateNote(note.id, { color });
		}
	}

	setReminderMany(
		ids: readonly string[],
		reminder: number | null,
		repeat: ReminderRepeat | null = null
	): void {
		for (const note of this.present(ids)) {
			this.updateNote(note.id, { reminder, repeat: repeat ?? undefined });
		}
	}

	/** Put the label on every note, or take it off every note. */
	setLabelMany(ids: readonly string[], labelId: string, on: boolean): void {
		for (const note of this.present(ids)) {
			const has = note.labels.includes(labelId);
			if (on && !has) this.updateNote(note.id, { labels: [...note.labels, labelId] });
			if (!on && has)
				this.updateNote(note.id, { labels: note.labels.filter((id) => id !== labelId) });
		}
	}

	/** Only notes still in the trash: one restored since it was picked is kept. */
	deleteNotesForever(ids: readonly string[]): void {
		const present = this.present(ids)
			.filter((note) => note.trashed)
			.map((note) => note.id);
		if (present.length === 0) return;
		void this.persistDeletedNotes(present).catch((err) =>
			this.recordPersistenceError('Could not delete notes', err)
		);
	}

	// Trash ----------------------------------------------------------------
	trashNote(id: string): void {
		const n = this.notes.find((x) => x.id === id);
		if (!n) return;
		const before = { trashed: n.trashed, trashedAt: n.trashedAt, pinned: n.pinned };
		const after = { trashed: true, trashedAt: Date.now(), pinned: false };
		this.updateNote(id, after);
		this.rememberFields(id, 'Moved to trash', before, after);
	}

	restoreNote(id: string): void {
		this.updateNote(id, { trashed: false, trashedAt: null, archived: false });
	}

	restoreToArchive(id: string): void {
		this.updateNote(id, { trashed: false, trashedAt: null, archived: true, pinned: false });
	}

	async deleteNoteForever(id: string): Promise<void> {
		actionUndo.dropNotes([id]);
		const pid = this.pid;
		// The delete and its upload marker are saved together, on top of the deletes
		// stored by then.
		const stored = await addTombstones(pid, { [id]: Date.now() }, [`note-tombstone:${id}`]);
		reminderHistoryStore.forgetNotes(pid, stored);
		if (pid === this.pid) {
			this.deletedNoteIds = newestTombstones(this.deletedNoteIds, stored);
			this.notes = this.notes.filter((n) => n.id !== id);
			// The tombstone is on disk, so a mirror that still lists the note cannot bring it back.
			this.scheduleMirror();
		}
		await deleteNote(pid, id).catch((err) =>
			this.recordPersistenceError(`Could not delete note ${id}`, err)
		);
		syncScheduler.changed(pid);
	}

	emptyTrash(): void {
		const ids = this.trashedNotes.map((n) => n.id);
		if (ids.length === 0) return;
		void this.persistDeletedNotes(ids).catch((err) =>
			this.recordPersistenceError('Could not empty trash', err)
		);
	}

	// Labels ---------------------------------------------------------------
	createLabel(name: string): Label | null {
		const trimmed = name.trim();
		if (!trimmed) return null;
		if (this.labels.some((l) => l.name.toLowerCase() === trimmed.toLowerCase())) return null;
		const now = syncClock.now();
		const label: Label = {
			id: uid(),
			name: trimmed,
			createdAt: now,
			updatedAt: now,
			writer: editContext.writer
		};
		this.labels = [...this.labels, label].sort((a, b) => a.name.localeCompare(b.name));
		this.mirrorLabels();
		putLabel(this.pid, label, [`label:${label.id}`]).catch((err) =>
			this.recordPersistenceError('Could not save label', err)
		);
		this.markLabelsDirty([`label:${label.id}`]);
		return label;
	}

	renameLabel(id: string, name: string): void {
		const trimmed = name.trim();
		if (!trimmed) return;
		const idx = this.labels.findIndex((l) => l.id === id);
		if (idx === -1) return;
		const renamed = {
			...this.labels[idx],
			name: trimmed,
			// Same-millisecond renames and backward clock jumps must still win.
			updatedAt: Math.max(syncClock.now(), this.labels[idx].updatedAt + 1),
			writer: editContext.writer
		};
		this.labels[idx] = renamed;
		this.labels.sort((a, b) => a.name.localeCompare(b.name));
		this.mirrorLabels();
		putLabel(this.pid, renamed, [`label:${renamed.id}`]).catch((err) =>
			this.recordPersistenceError('Could not rename label', err)
		);
		this.markLabelsDirty([`label:${renamed.id}`]);
	}

	removeLabel(id: string, options: { deleteNotes?: boolean } = {}): void {
		const label = this.labels.find((item) => item.id === id);
		if (!label) return;
		const snapshots: NoteTrashState[] = this.notes
			.filter((note) => note.labels.includes(id))
			.map((note) => ({
				id: note.id,
				trashed: note.trashed,
				trashedAt: note.trashedAt,
				pinned: note.pinned,
				archived: note.archived
			}));
		const deletedAt = Date.now();
		const affected = this.notes.filter((note) => note.labels.includes(id));

		if (options.deleteNotes) {
			// Trash notes that carry this label (recoverable from Trash).
			this.notes = this.notes.map((note) => {
				if (!note.labels.includes(id)) return note;
				const labels = note.labels.filter((labelId) => labelId !== id);
				if (note.trashed) return applyNoteEdit(note, { labels }, editContext);
				return applyNoteEdit(
					note,
					{ labels, trashed: true, trashedAt: deletedAt, pinned: false },
					editContext
				);
			});
			this.labels = this.labels.filter((item) => item.id !== id);
			this.mirrorLabels();
			this.persistNotes(affected.map((note) => note.id));
			this.markLabelsDeleted([id], deletedAt);
		} else {
			this.labels = this.labels.filter((item) => item.id !== id);
			const affectedNoteIds: string[] = [];
			this.notes = this.notes.map((note) => {
				if (!note.labels.includes(id)) return note;
				affectedNoteIds.push(note.id);
				return applyNoteEdit(
					note,
					{ labels: note.labels.filter((labelId) => labelId !== id) },
					editContext
				);
			});
			this.mirrorLabels();
			this.persistNotes(affectedNoteIds);
			this.markLabelsDeleted([id], deletedAt);
		}
		this.rememberRemovedLabel(label, snapshots, options);
	}

	// Search ---------------------------------------------------------------
	search(query: string, pool?: Note[], filters: SearchFilters = NO_FILTERS): Note[] {
		const q = query.trim().toLowerCase();
		const base = pool ?? this.activeNotes;
		const narrowed =
			activeFilterCount(filters) === 0 ? base : base.filter((n) => matchesFilters(n, filters));
		if (!q) return narrowed;
		const labelsById = this.labelsById;
		return narrowed.filter((n) => {
			if (n.title.toLowerCase().includes(q)) return true;
			if (
				joinWrappedHttpUrls(n.body ?? '')
					.toLowerCase()
					.includes(q)
			)
				return true;
			return n.labels.some((lid) => labelsById.get(lid)?.name.toLowerCase().includes(q));
		});
	}

	// Backup ---------------------------------------------------------------
	/**
	 * Snapshot of the open workspace only: its notes (with full-resolution
	 * attachments), labels, boards, tombstones, canvas library, reminder
	 * history, and UI prefs. Never carries sync identity.
	 */
	async exportBackup(): Promise<ScrapsCacheBackup> {
		const pid = this.pid;
		// Everything but the attachment bytes is taken at once: loading those takes a
		// while, and the window may be on another workspace before it is done.
		const notes = this.notes.map(cloneNote);
		const rest = this.backupWithoutNotes();
		const fullNotes: Note[] = [];
		for (const note of notes) {
			const needsFull = (note.images ?? []).some((image) => !image.dataUrl);
			fullNotes.push(needsFull ? await hydrateNoteAttachments(pid, note) : note);
		}
		return { ...rest, notes: fullNotes };
	}

	private backupWithoutNotes(): Omit<ScrapsCacheBackup, 'notes'> {
		return {
			version: 5,
			exportedAt: Date.now(),
			labels: this.labels.map((label) => ({ ...label })),
			boards: kanbanStore.boardsForSync(),
			activeBoardId: kanbanStore.activeBoardId,
			tombstones: { ...this.deletedNoteIds },
			labelTombstones: { ...this.deletedLabelIds },
			boardTombstones: kanbanStore.boardTombstonesForSync(),
			canvasLibrary: canvasLibraryStore.items(),
			reminderHistory: reminderHistoryStore.entriesForBackup(),
			ui: {
				sidebarOpen: uiStore.sidebarOpen,
				dark: uiStore.dark,
				layout: uiStore.layout,
				view: uiStore.view,
				rawMarkdown: uiStore.rawMarkdown
			}
		};
	}

	private async compactPersistedNoteImages(note: Note): Promise<void> {
		note.images = await Promise.all((note.images ?? []).map(prepareAttachmentForMemory));
	}

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
				// The boards are the backup's now; a mirror of the ones before would merge back in.
				afterLanding: replace ? () => clearBoardsMirror(pid) : undefined,
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
		return this.runImport('Could not import Google Keep notes', async () => {
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
				plan: () => planKeepImport({ notes, labels, mode, now: Date.now() })
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
					plan: (accountId: string | null) => ImportPlan;
					beforeLanding?: () => void;
					afterLanding?: () => void;
					/** Finishes an import whose workspace is still the open one. */
					whenOpen?: () => void;
			  }
		>
	): Promise<{ success: boolean; error?: string }> {
		if (this.importing) return { success: false, error: 'An import is already running.' };
		const pid = this.pid;
		this.importing = true;
		let landed = false;
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
			// Landing reloads this window when it shows the workspace, so the window
			// stays where it is meanwhile; a sync of the workspace gives way.
			return await withWorkspaceLock(() =>
				syncScheduler.rewrite(pid, async () => {
					// The workspace may have been removed while the import was prepared.
					const profile = syncStore.profiles.find((entry) => entry.id === pid);
					if (!profile || isProfileReleased(pid))
						return { success: false, error: IMPORT_TARGET_GONE };
					// What this window has still to save is part of what the import lands on.
					if (pid === this.pid) await this.waitForPendingProfileWrites();
					prepared.beforeLanding?.();
					const plan = prepared.plan(
						profile.syncKey ? identityFromSyncKey(profile.syncKey).accountId : null
					);
					await rewriteWorkspace(pid, plan.notes, plan.stateKeys, plan.land);
					landed = true;
					// The mirrors are only a faster start. A full `localStorage` must not keep
					// what has landed from being loaded and sent.
					try {
						prepared.afterLanding?.();
						await this.mirrorFromDevice(pid);
						// An import is not a first start: a workspace it leaves empty stays empty.
						if (typeof localStorage !== 'undefined')
							localStorage.setItem('scrapscache-seeded', '1');
					} catch (err) {
						console.error('[notes] could not refresh the mirrors after an import', err);
					}
					if (pid === this.pid) {
						await this.reloadForProfile();
						prepared.whenOpen?.();
					}
					syncScheduler.changed(pid);
					syncScheduler.announce(pid);
					return { success: true };
				})
			);
		} catch (err) {
			// Only the open workspace's trouble shows on its sync indicator.
			if (pid === this.pid) this.recordPersistenceError(failure, err);
			else console.error(`[notes] ${failure}`, err);
			// Once landed the import is in the database, whatever went wrong after.
			if (landed) return { success: true };
			return { success: false, error: `${failure}: ${formatStorageError(err)}` };
		} finally {
			this.importing = false;
		}
	}

	/** Bring a workspace's fast-boot mirror level with its database once an import has rewritten it. */
	private async mirrorFromDevice(pid: string): Promise<void> {
		const [notes, labels, tombstones] = await Promise.all([
			getAllNotesMetadata(pid),
			getAllLabels(pid),
			readStoredTombstones(pid)
		]);
		writeNotesMirror(withoutTombstoned(notes, tombstones.notes), pid);
		writeLabelsMirror(withoutTombstoned(labels, tombstones.labels), pid);
	}

	// Reload all three layers. Mirror is only a fast-boot cache; IDB always participates so
	// image blobs are rehydrated even when a mirror exists.
	/**
	 * Point the in-memory state at another profile's namespace. Datasets live
	 * in separate IDB namespaces, so this only drops pending writes belonging
	 * to the previous profile and reloads from storage.
	 */
	async reloadForProfile(): Promise<void> {
		actionUndo.clear();
		this.cancelScheduledMirror();
		for (const timer of this.noteRetryTimers.values()) clearTimeout(timer);
		this.noteRetryTimers.clear();
		for (const held of this.noteRetryHolds.values()) held.forEach((landed) => landed());
		this.noteRetryHolds.clear();
		this.noteRetryAttempts.clear();
		this.attachmentLoads.clear();
		this.visibleAttachmentQueue.clear();
		this.lastPersistError = null;
		syncStore.lastError = null;
		resetTombstoneCaches();
		this.loaded = false;
		this.notes = [];
		this.labels = [];
		this.deletedNoteIds = {};
		this.deletedLabelIds = {};
		await this.init();
		await this.refreshProfileEffects();
	}

	async refreshProfileEffects(): Promise<void> {
		await this.onProfileReload?.(this.pid, this.notes);
	}

	/** An accepted photo import must finish before its workspace is handed over. */
	trackAttachmentWork(work: Promise<void>): void {
		this.attachmentWork.add(work);
		void work.then(
			() => this.attachmentWork.delete(work),
			() => this.attachmentWork.delete(work)
		);
	}

	/** Drain side effects that must remain owned by the outgoing profile. */
	async waitForPendingProfileWrites(): Promise<void> {
		while (this.attachmentWork.size > 0) {
			await Promise.allSettled([...this.attachmentWork]);
		}
		if (this.attachmentPass) await this.attachmentPass;
		while (this.attachmentLoads.size > 0) {
			await Promise.allSettled([...this.attachmentLoads.values()]);
		}
		await syncStore.waitForOutboxWrites();
		await kanbanStore.waitForPendingWrites();
		await canvasLibraryStore.waitForPendingWrites();
		await reminderHistoryStore.waitForPendingWrites();
		await waitForDeviceWrites(this.pid);
	}

	// Persistence helpers --------------------------------------------------

	private rememberFields(id: string, message: string, before: NotePatch, after: NotePatch): void {
		actionUndo.push({
			message,
			noteIds: [id],
			undo: () => this.updateNote(id, before),
			redo: () => this.updateNote(id, after)
		});
	}

	/**
	 * Remove one attachment. Its bytes are dropped from the device with it, so the
	 * undo step keeps the copy the caller has on screen.
	 */
	async removeAttachment(id: string, attachment: NoteImage): Promise<void> {
		let note = this.notes.find((item) => item.id === id);
		let currentAttachment = note?.images?.find((image) => image.id === attachment.id);
		if (!note || !currentAttachment) return;

		// The undo step must keep full bytes; an editor can still show a thumbnail
		// while the attachment itself is being loaded from IndexedDB.
		if (!attachment.dataUrl && !currentAttachment.dataUrl) {
			await this.ensureNoteAttachments(id);
			note = this.notes.find((item) => item.id === id);
			currentAttachment = note?.images?.find((image) => image.id === attachment.id);
			if (!note || !currentAttachment) return;
		}
		const kept = {
			...currentAttachment,
			...(attachment.dataUrl && !currentAttachment.dataUrl ? { dataUrl: attachment.dataUrl } : {})
		};
		if (!kept.dataUrl) throw new Error('Could not load the attachment bytes; it was not removed.');

		const without = (images: NoteImage[] = []) =>
			images.filter((image) => image.id !== attachment.id);
		const bodyBefore = note.body ?? '';
		const bodyAfterRemoval = stripPhotoMarkers(bodyBefore, [attachment.id]);
		const removedMarkers = bodyBefore
			.split('\n')
			.filter((line) => parsePhotoMarker(line)?.id === attachment.id);
		const saved = this.flushNote(id, {
			images: without(note.images),
			...(bodyAfterRemoval !== bodyBefore ? { body: bodyAfterRemoval } : {})
		});
		actionUndo.push({
			message: 'Attachment removed',
			noteIds: [id],
			undo: () => {
				const current = this.notes.find((item) => item.id === id);
				if (!current) return;
				const bodyNow = current.body ?? '';
				let restoredBody = bodyNow;
				if (removedMarkers.length > 0 && !bodyHasPhotoMarker(bodyNow, attachment.id)) {
					if (bodyNow === bodyAfterRemoval) {
						restoredBody = bodyBefore;
					} else {
						const separator = bodyNow === '' || bodyNow.endsWith('\n') ? '' : '\n';
						restoredBody = `${bodyNow}${separator}${removedMarkers.join('\n')}`;
					}
				}
				this.updateNote(id, {
					images: [...without(current.images), kept],
					...(restoredBody !== bodyNow ? { body: restoredBody } : {})
				});
			},
			redo: () => {
				const current = this.notes.find((item) => item.id === id);
				if (!current) return;
				const bodyNow = current.body ?? '';
				const bodyAfterRedo = stripPhotoMarkers(bodyNow, [attachment.id]);
				this.updateNote(id, {
					images: without(current.images),
					...(bodyAfterRedo !== bodyNow ? { body: bodyAfterRedo } : {})
				});
			}
		});
		await saved;
	}

	private ensureLabel(name: string): Label | null {
		return (
			this.labels.find((label) => label.name.toLowerCase() === name.toLowerCase()) ??
			this.createLabel(name)
		);
	}

	/** Undo brings the label back by name and tags its notes again; notes it trashed come back. */
	private rememberRemovedLabel(
		label: Label,
		snapshots: NoteTrashState[],
		options: { deleteNotes?: boolean }
	): void {
		let revivedId: string | null = null;
		actionUndo.push({
			message: 'Label deleted',
			noteIds: snapshots.map((snap) => snap.id),
			undo: () => {
				const revived = this.ensureLabel(label.name);
				if (!revived) return;
				revivedId = revived.id;
				for (const { id, ...trashState } of snapshots) {
					const current = this.notes.find((note) => note.id === id);
					if (!current) continue;
					this.updateNote(id, {
						labels: [...new Set([...current.labels, revived.id])],
						...(options.deleteNotes ? trashState : {})
					});
				}
			},
			redo: () => {
				if (revivedId) this.removeLabel(revivedId, options);
			}
		});
	}

	private async persistDeletedNotes(ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		actionUndo.dropNotes(ids);
		const pid = this.pid;
		const deletedAt = Date.now();
		// The deletes and their upload markers are saved together, on top of the
		// deletes stored by then.
		const stored = await addTombstones(
			pid,
			Object.fromEntries(ids.map((id) => [id, deletedAt])),
			ids.map((id) => `note-tombstone:${id}`)
		);
		reminderHistoryStore.forgetNotes(pid, stored);
		if (pid === this.pid) {
			this.deletedNoteIds = newestTombstones(this.deletedNoteIds, stored);
			this.notes = this.notes.filter((n) => !ids.includes(n.id));
			this.scheduleMirror();
		}
		syncScheduler.changed(pid);
		await Promise.all(ids.map((id) => deleteNote(pid, id)));
	}

	private markLabelsDeleted(ids: string[], deletedAt = Date.now()): void {
		if (ids.length === 0) return;
		const next = { ...this.deletedLabelIds };
		for (const id of ids) next[id] = deletedAt;
		this.deletedLabelIds = next;
		const pid = this.pid;
		void Promise.all(
			ids.map((id) => deleteLabelWithTombstone(pid, id, deletedAt, [`label-tombstone:${id}`]))
		)
			.then(() => this.markLabelsDirty())
			.catch((err) => this.recordPersistenceError('Could not delete label', err));
	}

	private markLabelsDirty(keys: Iterable<string> = []): void {
		syncStore.requestAutoSync(keys);
		this.scheduleSyncPush();
	}

	private mayMirror(): boolean {
		// A workspace removed in another window keeps no mirror either: writing
		// one back would leave note text behind for a workspace that is gone.
		if (isProfileReleased(this.pid)) return false;
		// Another window has written newer notes than this one holds.
		return this.staleWhileHidden !== this.pid;
	}

	/** Write the fast-boot mirror now: every note and label this window holds. */
	private mirrorToLS() {
		this.cancelScheduledMirror();
		if (!this.mayMirror()) return;
		if (!writeNotesMirror(this.notes, this.pid)) {
			this.recordPersistenceError(
				'Could not update the local notes mirror',
				new Error('localStorage write failed')
			);
		}
		writeLabelsMirror(this.labels, this.pid);
	}

	private mirrorLabels() {
		if (this.mayMirror()) writeLabelsMirror(this.labels, this.pid);
	}

	private mirrorTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Refresh the fast-boot mirror once edits pause. Serializing every note on
	 * each save would cost a large workspace a long task per keystroke, and so
	 * would doing it every few seconds of steady typing. Crash safety does not
	 * wait for it: each edit is journaled before its write starts, and a hidden
	 * or closing page writes the mirror at once.
	 */
	private scheduleMirror() {
		this.cancelScheduledMirror();
		const pid = this.pid;
		this.mirrorTimer = setTimeout(() => {
			this.mirrorTimer = null;
			// The window moved to another workspace; its own boot writes that mirror.
			if (pid === this.pid) this.mirrorToLS();
		}, MIRROR_DELAY_MS);
	}

	private cancelScheduledMirror() {
		if (this.mirrorTimer) clearTimeout(this.mirrorTimer);
		this.mirrorTimer = null;
	}

	/** Journal notes whose IndexedDB writes are about to start. */
	private journal(notes: Note[]) {
		if (isProfileReleased(this.pid)) return;
		if (!journalPendingNotes(notes, this.pid)) {
			this.recordPersistenceError(
				'Could not journal unsaved notes',
				new Error('localStorage write failed')
			);
		}
	}

	private recordPersistenceError(context: string, err: unknown): void {
		const detail = formatStorageError(err);
		this.lastPersistError = `${context}: ${detail}`;
		console.error(`[notes] ${context}`, err);
	}

	private noteRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
	/** The holds on the attachment-writes lock that each waiting retry carries. */
	private noteRetryHolds = new Map<string, Array<() => void>>();
	private noteRetryAttempts = new Map<string, number>();
	/** The workspace another window synced while this one was hidden and skipped re-reading. */
	private staleWhileHidden: string | null = null;

	/**
	 * Hold the attachment-writes lock for a write of this note that carries bytes,
	 * until the function returned is called. Asked for before the note is journaled:
	 * once another window can read that it lists new bytes, it can tell they have
	 * not landed.
	 */
	private holdWhileBytesLand(pid: string, note: Note): () => void {
		return (note.images ?? []).some((image) => image.dataUrl)
			? holdAttachmentWrites(pid)
			: () => undefined;
	}

	/**
	 * Write the note again in a while. `bytesLanded` is the failed write's hold on
	 * the attachment-writes lock: the retry keeps that same hold, so a window already
	 * waiting to read what is stored goes on waiting until the bytes are in.
	 */
	private scheduleNoteRetry(id: string, bytesLanded: () => void = () => undefined): void {
		this.noteRetryHolds.set(id, [...(this.noteRetryHolds.get(id) ?? []), bytesLanded]);
		if (this.noteRetryTimers.has(id)) return;
		const attempt = this.noteRetryAttempts.get(id) ?? 0;
		const delay = Math.min(30_000, 1_000 * 2 ** attempt);
		const timer = setTimeout(() => {
			this.noteRetryTimers.delete(id);
			const held = this.noteRetryHolds.get(id) ?? [];
			this.noteRetryHolds.delete(id);
			const allLanded = () => held.forEach((landed) => landed());
			const note = this.notes.find((item) => item.id === id);
			if (!note) return allLanded();
			const pid = this.pid;
			putNote(pid, note, noteRecordKeys(note))
				.then(() => {
					settlePendingNotes({ [id]: noteForLocalStorage(note) }, pid);
					this.noteRetryAttempts.delete(id);
					this.lastPersistError = null;
					this.scheduleSyncPush();
					allLanded();
				})
				.catch((err) => {
					this.noteRetryAttempts.set(id, attempt + 1);
					this.recordPersistenceError(`Could not retry note ${id}`, err);
					this.scheduleNoteRetry(id, allLanded);
				});
		}, delay);
		this.noteRetryTimers.set(id, timer);
	}

	/** Replay localStorage notes/labels that never landed in IndexedDB after a crash. */
	private async recoverMirrorIntoIndexedDB(dbNotes: Note[], dbLabels: Label[]): Promise<void> {
		const dbById = new Map(dbNotes.map((item) => [item.id, item]));
		for (const item of this.notes) {
			if (noteNeedsDurableWrite(dbById.get(item.id), item))
				await putNote(this.pid, item, noteRecordKeys(item));
		}
		const dbLabelById = new Map(dbLabels.map((item) => [item.id, item]));
		const labelKeys: string[] = [];
		for (const label of this.labels) {
			const current = dbLabelById.get(label.id);
			if (current && current.name === label.name && current.updatedAt === label.updatedAt) continue;
			await putLabel(this.pid, label);
			labelKeys.push(`label:${label.id}`);
		}
		if (labelKeys.length) await syncStore.queueOutbox(labelKeys);
	}

	private persist(id: string) {
		this.persistNotes([id]);
	}

	private persistNotes(ids: string[]) {
		const wanted = new Set(ids);
		const notes = this.notes.filter((note) => wanted.has(note.id));
		if (notes.length === 0) return;
		const pid = this.pid;
		const bytesLanded = notes.map((note) => this.holdWhileBytesLand(pid, note));
		// Preserve a crash-safe, blob-free copy synchronously before async IDB work.
		this.journal(notes);
		this.scheduleMirror();
		const landed: PendingNotes = {};
		void Promise.all(
			notes.map((note, index) =>
				this.writeNote(pid, note, bytesLanded[index]).then((ok) => {
					if (ok) landed[note.id] = noteForLocalStorage(note);
				})
			)
		).then(() => settlePendingNotes(landed, pid));
		this.scheduleSyncPush();
	}

	/**
	 * Write one note to IndexedDB; true once it landed. A failed write retries on its
	 * own, and takes `bytesLanded` with it: the lock is let go when the bytes are in.
	 */
	private writeNote(pid: string, note: Note, bytesLanded: () => void): Promise<boolean> {
		const id = note.id;
		// The attachments whose bytes this write carries. Only those may be released
		// from memory once it lands: a photo added while this write was queued has
		// its own write, which may still fail and retry from what is in memory.
		const written = new Set(
			(note.images ?? []).filter((image) => image.dataUrl).map((image) => image.id)
		);
		return putNote(pid, note, noteRecordKeys(note))
			.then(async () => {
				this.lastPersistError = null;
				// Keep only small thumbs in memory after a durable write of full blobs.
				const idx = this.notes.findIndex((item) => item.id === id);
				if (idx < 0) return true;
				const current = this.notes[idx];
				const images = await Promise.all(
					(current.images ?? []).map((image) =>
						written.has(image.id) ? prepareAttachmentForMemory(image) : image
					)
				);
				if (images.some((image, i) => image !== current.images?.[i])) {
					this.notes[idx] = { ...current, images };
					this.scheduleMirror();
				}
				bytesLanded();
				return true;
			})
			.catch((err) => {
				this.recordPersistenceError(`Could not save note ${id}`, err);
				this.scheduleNoteRetry(id, bytesLanded);
				return false;
			});
	}

	/** What changed here has to reach the relay: the open workspace syncs once changes pause. */
	private scheduleSyncPush(): void {
		syncScheduler.changed(this.pid);
	}

	/** Sync the open workspace now, without waiting for changes to pause. */
	flushSync(): Promise<boolean> {
		return syncScheduler.request(this.pid);
	}

	/** Flush durable local changes when leaving a note, without a no-op cloud request. */
	async syncPendingChanges(): Promise<boolean> {
		if (!syncStore.isLoggedIn) return false;
		await syncStore.waitForOutboxWrites();
		const pending = await getSyncOutboxKeys(this.pid).catch(() => []);
		if (pending.length === 0) return false;
		return this.flushSync();
	}

	private async notesForMemory(notes: Note[]): Promise<Note[]> {
		return Promise.all(
			notes.map(async (note) => ({
				...note,
				images: await Promise.all((note.images ?? []).map(prepareAttachmentForMemory))
			}))
		);
	}

	/**
	 * A sync saved into this workspace's database. Memory takes what it brought. A
	 * note edited here since the sync read it was edited as it was before the sync,
	 * and its own save may have landed on either side of the sync's, so the two
	 * merged are saved once more.
	 */
	private async showSynced(
		pid: string,
		saved: SyncSnapshot,
		decisions: AttachmentDecisions
	): Promise<void> {
		// A load under way read the database before or after this sync saved: either
		// way what was saved is merged into what it loaded.
		await this.boot;
		if (pid !== this.pid || !this.loaded) return;
		if (this.staleWhileHidden === pid) await this.rehydrateFromIDB();
		const lean = await this.notesForMemory(saved.notes);
		if (pid !== this.pid || !this.loaded) return;
		// Nothing is awaited from here until memory holds the result: an edit made in
		// between would be merged with neither.
		const tombstones = newestTombstones(this.deletedNoteIds, saved.tombstones);
		const labelTombstones = newestTombstones(this.deletedLabelIds, saved.labelTombstones);
		const savedById = new Map(saved.notes.map((note) => [note.id, note]));
		// Full bytes the database holds are let go of, as after any save. Bytes of a
		// photo it does not hold yet, or holds in another version, stay in memory:
		// their own save is still under way, and may have to be tried again.
		const withoutSavedBytes = (note: Note): Note => {
			const held = new Map(
				(savedById.get(note.id)?.images ?? []).map((image) => [image.id, image.contentHash])
			);
			const images = (note.images ?? []).map((image) =>
				held.has(image.id) && held.get(image.id) === image.contentHash
					? stripFullPreviewBytes(image)
					: image
			);
			return images.some((image, index) => image !== note.images?.[index])
				? { ...note, images }
				: note;
		};
		const notes = withoutTombstoned(mergeNoteLists(this.notes, lean), tombstones)
			.map((note) => withoutSavedBytes(withAttachmentDecisions(note, decisions)))
			.sort((a, b) => b.updatedAt - a.updatedAt);
		const labels = withoutTombstoned(
			mergeLabelLists(this.labels, saved.labels),
			labelTombstones
		).sort((a, b) => a.name.localeCompare(b.name));
		// What this window holds that the database does not is saved again, queued to
		// upload: an edit made on a note as it was before the sync, whose own save
		// landed on either side of the sync's, or a save that failed.
		const edited = notes.filter((note) => {
			const synced = savedById.get(note.id);
			return synced !== undefined && durableNoteSignature(synced) !== durableNoteSignature(note);
		});
		const savedLabels = new Map(saved.labels.map((label) => [label.id, label]));
		const editedLabels = labels.filter((label) => {
			const synced = savedLabels.get(label.id);
			return !synced || synced.updatedAt !== label.updatedAt || synced.name !== label.name;
		});
		const deletedLabels = Object.entries(labelTombstones).filter(
			([id, deletedAt]) => deletedAt > (saved.labelTombstones[id] || 0)
		);
		this.notes = notes;
		this.labels = labels;
		this.deletedNoteIds = tombstones;
		this.deletedLabelIds = labelTombstones;
		adoptTombstones(tombstones, labelTombstones);
		kanbanStore.applySync(saved.boards, saved.boardTombstones);
		canvasLibraryStore.applySync(saved.libraryItems, saved.libraryTombstones);
		this.scheduleMirror();
		this.lastPersistError = null;
		// Asked for in one step, so each takes its place ahead of any save made after
		// this: a later edit of the same note lands after it, never before.
		const saves = [
			...edited.map((note) => putNote(pid, note, noteRecordKeys(note))),
			...editedLabels.map((label) => putLabel(pid, label, [`label:${label.id}`])),
			...deletedLabels.map(([id, deletedAt]) =>
				deleteLabelWithTombstone(pid, id, deletedAt, [`label-tombstone:${id}`])
			)
		];
		await Promise.all(saves).catch((err) =>
			this.recordPersistenceError('Could not save what changed during a sync', err)
		);
		if (pid === this.pid) this.onAfterSync?.();
	}

	/** Merge an account's snapshot into this workspace from memory, for the pairing merge. */
	private async applyPulledSnapshot(snapshot: SyncSnapshot, pid: string): Promise<SyncSnapshot> {
		// It belongs to the workspace it was read for. If the window has moved to
		// another one, none of this may land: it would merge one workspace's notes
		// into another's and save them there.
		if (pid !== this.pid) return snapshot;
		const tombstones = { ...this.deletedNoteIds };
		for (const [id, deletedAt] of Object.entries(snapshot.tombstones)) {
			if (deletedAt > (tombstones[id] || 0)) tombstones[id] = deletedAt;
		}
		const labelTombstones = { ...this.deletedLabelIds };
		for (const [id, deletedAt] of Object.entries(snapshot.labelTombstones)) {
			if (deletedAt > (labelTombstones[id] || 0)) labelTombstones[id] = deletedAt;
		}

		let durableNotes = withoutTombstoned(
			mergeNoteLists(this.notes, snapshot.notes),
			tombstones
		).sort((a, b) => b.updatedAt - a.updatedAt);
		let mergedLabels = withoutTombstoned(
			mergeLabelLists(this.labels, snapshot.labels),
			labelTombstones
		).sort((a, b) => a.name.localeCompare(b.name));
		const currentById = new Map(this.notes.map((note) => [note.id, note]));
		const notesToPersist = durableNotes.filter((note) =>
			noteNeedsDurableWrite(currentById.get(note.id), note)
		);
		const labelsChanged = stableStringify(this.labels) !== stableStringify(mergedLabels);
		const tombstonedNoteIds = this.notes
			.filter((note) => tombstones[note.id])
			.map((note) => note.id);
		const tombstonedLabelIds = this.labels
			.filter((label) => labelTombstones[label.id])
			.map((label) => label.id);

		kanbanStore.applySync(snapshot.boards, snapshot.boardTombstones);
		canvasLibraryStore.applySync(snapshot.libraryItems, snapshot.libraryTombstones);
		reminderHistoryStore.forgetNotes(this.pid, tombstones);
		await writeTombstones(this.pid, tombstones);
		await writeLabelTombstones(this.pid, labelTombstones);
		for (const note of notesToPersist) {
			// An edit made while this awaited has already queued its own write; saving
			// the older merge after it would roll the device copy back.
			const live = this.notes.find((item) => item.id === note.id);
			const edited = live && live !== currentById.get(note.id);
			await putNote(this.pid, edited ? mergeTwoNotes(live, note) : note);
		}
		for (const id of tombstonedNoteIds) await deleteNote(this.pid, id);
		for (const id of tombstonedLabelIds) await deleteLabel(this.pid, id);
		if (labelsChanged) await bulkPutLabels(this.pid, mergedLabels);
		await kanbanStore.persistSyncState(this.pid);
		await canvasLibraryStore.persistSyncState(this.pid);
		await reminderHistoryStore.waitForPendingWrites();

		// Preserve edits made while the device writes were in flight.
		durableNotes = withoutTombstoned(mergeNoteLists(this.notes, durableNotes), tombstones).sort(
			(a, b) => b.updatedAt - a.updatedAt
		);
		mergedLabels = withoutTombstoned(
			mergeLabelLists(this.labels, mergedLabels),
			labelTombstones
		).sort((a, b) => a.name.localeCompare(b.name));
		this.notes = await this.notesForMemory(durableNotes);
		this.labels = mergedLabels;
		this.deletedNoteIds = tombstones;
		this.deletedLabelIds = labelTombstones;
		// Everything above is on disk already; the mirror only has to catch up for the next boot.
		this.scheduleMirror();
		this.lastPersistError = null;

		return this.syncSnapshot({ notes: durableNotes, labels: mergedLabels });
	}

	/** This workspace as a sync sees it. */
	private syncSnapshot(parts: Pick<SyncSnapshot, 'notes' | 'labels'>): SyncSnapshot {
		return {
			...parts,
			boards: kanbanStore.boardsForSync(),
			tombstones: { ...this.deletedNoteIds },
			labelTombstones: { ...this.deletedLabelIds },
			boardTombstones: kanbanStore.boardTombstonesForSync(),
			libraryItems: canvasLibraryStore.entriesForSync(),
			libraryTombstones: canvasLibraryStore.tombstonesForSync()
		};
	}

	private async applyCloudReplacement(
		snapshot: SyncSnapshot,
		pid: string,
		pulled: { readEnvelopes: number }
	): Promise<SyncSnapshot> {
		// Replacing this device's notes with the cloud's belongs to one workspace.
		if (pid !== this.pid) return snapshot;
		const notes = withoutTombstoned(snapshot.notes, snapshot.tombstones).sort(
			(a, b) => b.updatedAt - a.updatedAt
		);
		const labels = withoutTombstoned(snapshot.labels, snapshot.labelTombstones).sort((a, b) =>
			a.name.localeCompare(b.name)
		);
		// Replacing wipes this device, so a pull that read nothing of an account that
		// holds envelopes must not stand in for it. An account without notes is fine:
		// every synced workspace stores at least its name.
		if (pulled.readEnvelopes === 0 && (syncStore.usage?.envelopeCount ?? 0) > 0) {
			throw new Error('Could not download synced notes');
		}
		if (navigator.storage?.estimate) {
			const estimate = await navigator.storage.estimate();
			if (!replacementFitsStorage(notes, estimate)) {
				throw new Error(
					'Storage full on this device — free space or remove old notes/attachments.'
				);
			}
		}
		await replaceAllDeviceData(pid, notes, labels, (note) => this.compactPersistedNoteImages(note));
		if (pid !== this.pid) return snapshot;
		this.notes = notes;
		this.labels = labels;
		this.deletedNoteIds = { ...snapshot.tombstones };
		this.deletedLabelIds = { ...snapshot.labelTombstones };
		kanbanStore.replaceWithCloud(snapshot.boards, snapshot.boardTombstones);
		canvasLibraryStore.replaceWithCloud(snapshot.libraryItems, snapshot.libraryTombstones);
		// History only ever grows: what this device already showed stays shown.
		reminderHistoryStore.forgetNotes(this.pid, this.deletedNoteIds);
		await writeTombstones(this.pid, this.deletedNoteIds);
		await writeLabelTombstones(this.pid, this.deletedLabelIds);
		await kanbanStore.persistSyncState(this.pid);
		await canvasLibraryStore.persistSyncState(this.pid);
		await reminderHistoryStore.waitForPendingWrites();
		this.mirrorToLS();
		return this.syncSnapshot({ notes, labels });
	}

	/** Pairing merge: keep every local note and every account note. Same ids get a new local id. */
	async mergeWithCloudManual(): Promise<boolean> {
		if (!syncStore.isLoggedIn || !syncStore.account) return false;
		const merged = await syncScheduler.rewrite(this.pid, (signal) =>
			this.mergeWithCloudLocked(signal)
		);
		if (!merged) return false;
		return this.syncWithCloudManual();
	}

	// Runs as a rewrite: the control-plane reset below must never interleave with a
	// sync round's baseline/cursor commits.
	private async mergeWithCloudLocked(signal: AbortSignal): Promise<boolean> {
		const account = syncStore.account;
		if (!syncStore.isLoggedIn || !account) return false;
		const original = this.notes.map(cloneNote);
		try {
			await this.hydrateAllAttachments();
			const leftover = await getSyncOutboxKeys(this.pid).catch(() => []);
			if (leftover.length) await clearSyncOutbox(this.pid, leftover);
			await syncStore.clearAccountControlPlane(account.accountId);
			const pulledSnapshots: SyncSnapshot[] = [];
			const pulled = await syncStore.pullOpen(
				syncSnapshot(),
				async (snapshot) => {
					pulledSnapshots.push({
						...snapshot,
						notes: snapshot.notes.map(cloneNote),
						labels: snapshot.labels.map((label) => ({ ...label })),
						boards: snapshot.boards.map((board) => ({
							...board,
							columns: board.columns.map((column) => ({ ...column })),
							backlogFilter: {
								...board.backlogFilter,
								labelIds: [...board.backlogFilter.labelIds]
							},
							noteFilter: { ...board.noteFilter, labelIds: [...board.noteFilter.labelIds] }
						})),
						tombstones: { ...snapshot.tombstones },
						labelTombstones: { ...snapshot.labelTombstones },
						boardTombstones: { ...snapshot.boardTombstones },
						libraryItems: snapshot.libraryItems.map((entry) => ({ ...entry })),
						libraryTombstones: { ...snapshot.libraryTombstones }
					});
					return snapshot;
				},
				signal
			);
			const server = pulledSnapshots.at(-1);
			if (!pulled.success || !server) {
				this.recordPersistenceError(
					pulled.error || 'Could not download synced notes',
					pulled.error
				);
				return false;
			}
			const remapped = retargetLocalNotes(
				this.notes.map(cloneNote),
				server.notes,
				server.tombstones,
				uid
			);
			for (let index = 0; index < original.length; index++) {
				const before = original[index];
				const after = remapped[index];
				const imagesChanged = (after.images ?? []).some(
					(image, imageIndex) => image.id !== (before.images ?? [])[imageIndex]?.id
				);
				if (before.id !== after.id || imagesChanged) {
					await putNote(this.pid, after, noteRecordKeys(after));
				}
			}
			this.notes = remapped;
			try {
				await this.applyPulledSnapshot(server, this.pid);
			} catch (err) {
				this.notes = original;
				throw err;
			}
			const kept = new Set(this.notes.map((note) => note.id));
			for (const note of original) {
				if (!kept.has(note.id)) await deleteNote(this.pid, note.id);
			}
			await syncStore.clearAccountControlPlane(account.accountId);
			return true;
		} catch (err) {
			this.recordPersistenceError('Could not merge local notes with synced notes', err);
			return false;
		}
	}

	// Replace this device's local data with the already-linked account without uploading any
	// local records or tombstones first. The cloud response is obtained before local storage is cleared.
	async replaceWithCloudManual(): Promise<boolean> {
		if (!syncStore.isLoggedIn || !syncStore.account) return false;
		return syncScheduler.rewrite(this.pid, (signal) => this.replaceWithCloudLocked(signal));
	}

	private async replaceWithCloudLocked(signal: AbortSignal): Promise<boolean> {
		if (!syncStore.isLoggedIn || !syncStore.account) return false;
		actionUndo.clear();
		try {
			const leftover = await getSyncOutboxKeys(this.pid).catch(() => []);
			if (leftover.length) await clearSyncOutbox(this.pid, leftover);
			await syncStore.clearAccountControlPlane(syncStore.account.accountId);
			const result = await syncStore.pullOpen(
				syncSnapshot(),
				(snapshot, pid, pulled) => this.applyCloudReplacement(snapshot, pid, pulled),
				signal
			);
			if (!result.success || !result.snapshot) {
				this.recordPersistenceError(result.error || 'Cloud sync returned no notes', result.error);
				return false;
			}
			this.lastPersistError = null;
			this.onAfterSync?.();
			return true;
		} catch (err) {
			this.recordPersistenceError('Could not replace this device with cloud notes', err);
			return false;
		}
	}

	async forcePushWorkspace(turnstileToken?: string): Promise<boolean> {
		const pid = this.pid;
		return syncScheduler.rewrite(pid, async (signal) => {
			const account = syncStore.account;
			const profile = syncStore.activeProfile;
			if (!account || !profile || pid !== this.pid) return false;
			try {
				await this.waitForPendingProfileWrites();
				await this.hydrateAllAttachments();
				// This device's copy becomes the cloud's, so every photo it lists has to be
				// here in full: one that could not be read, or was never received, stops it.
				if (this.notes.some((note) => (note.images ?? []).some((image) => !image.dataUrl)))
					throw new Error(
						'Some attachments could not be loaded. Replacing the cloud copy was not started.'
					);
				await syncStore.reauthenticateForRecovery(turnstileToken, signal);
				await syncStore.clearAccountControlPlane(account.accountId);
				let remote: SyncSnapshot | undefined;
				const pulled = await syncStore.pullOpen(
					syncSnapshot(),
					async (snapshot) => {
						remote = snapshot;
						return snapshot;
					},
					signal
				);
				if (!pulled.success || !remote)
					throw new Error(
						pulled.error ?? 'Could not read cloud state before replacing the cloud copy'
					);
				const snapshot = buildForcePushSnapshot(
					this.syncSnapshot({ notes: this.notes.map(cloneNote), labels: [...this.labels] }),
					remote,
					editContext
				);
				await bulkPutNotes(this.pid, snapshot.notes);
				await bulkPutLabels(this.pid, snapshot.labels);
				this.notes = snapshot.notes;
				this.labels = snapshot.labels;
				this.deletedNoteIds = snapshot.tombstones;
				this.deletedLabelIds = snapshot.labelTombstones;
				kanbanStore.replaceWithCloud(snapshot.boards, snapshot.boardTombstones);
				canvasLibraryStore.replaceWithCloud(snapshot.libraryItems, snapshot.libraryTombstones);
				reminderHistoryStore.forgetNotes(this.pid, snapshot.tombstones);
				await writeTombstones(this.pid, snapshot.tombstones);
				await writeLabelTombstones(this.pid, snapshot.labelTombstones);
				await kanbanStore.persistSyncState(this.pid);
				await canvasLibraryStore.persistSyncState(this.pid);
				await reminderHistoryStore.waitForPendingWrites();
				this.mirrorToLS();
				// The pull left this device holding the cloud's ids and fingerprints. Queue every
				// record so the upload sends each one the cloud does not already hold, without
				// downloading the whole account a second time.
				await markSyncOutbox(this.pid, [...currentRecordKeys(snapshot)]);
				// This rewrite holds the workspace's sync lock, so its upload runs here.
				syncStore.onSyncStart?.();
				const synced = await syncWorkspace(profile, signal, (saved, decisions) =>
					this.showSynced(pid, saved, decisions)
				)
					.then((outcome) => outcome === 'synced')
					.finally(() => syncStore.onSyncEnd?.());
				if (synced) syncScheduler.announce(pid);
				return synced && !syncStore.lastError && !this.lastPersistError;
			} catch (err) {
				this.recordPersistenceError('Could not replace the cloud copy', err);
				return false;
			}
		});
	}

	syncWithCloudManual(): Promise<boolean> {
		return this.flushSync();
	}

	/** Settle with the cloud once: join the sync under way, or start one. */
	reconcileWithCloud(): Promise<boolean> {
		return syncScheduler.catchUp(this.pid);
	}

	/**
	 * A reason to sync now: a live nudge from another device, a reminder, a workspace
	 * just opened. Skipped when this device already has what the nudge is about.
	 */
	triggerSync(serverSeq?: number): Promise<boolean> {
		if (!syncStore.isLoggedIn) return Promise.resolve(false);
		if (typeof serverSeq === 'number' && serverSeq > 0 && serverSeq <= syncStore.syncedCursor) {
			return Promise.resolve(true);
		}
		return syncScheduler.request(this.pid);
	}

	/**
	 * Catch up with the cloud when the app starts or comes to the foreground. Those
	 * arrive together, especially on iOS, and ask for the same thing: they join a
	 * sync under way, and are skipped when the workspace has just synced.
	 */
	syncWithCloud(): Promise<boolean> {
		return syncScheduler.catchUp(this.pid, CAUGHT_UP_MS);
	}

	// Seed -----------------------------------------------------------------
	private seedNotes(): Note[] {
		const now = Date.now();
		return [
			{
				id: uid(),
				title: 'Welcome to Scraps Cache 👋',
				body: 'Small note fragments, offline-first. Notes live on this device. Tap the cloud icon (Sync settings) to sync them. Try pins, archive, colours, checklists, and reminders.',
				color: 'yellow',
				pinned: true,
				archived: false,
				trashed: false,
				trashedAt: null,
				createdAt: now,
				updatedAt: now,
				reminder: null,
				labels: []
			},
			{
				id: uid(),
				title: 'Groceries',
				body: '[x] Oat milk\n[ ] Sourdough bread\n[ ] Avocados\n[ ] Dark chocolate',
				color: 'green',
				pinned: false,
				archived: false,
				trashed: false,
				trashedAt: null,
				createdAt: now - 1000,
				updatedAt: now - 1000,
				reminder: null,
				labels: []
			},
			{
				id: uid(),
				title: 'Reading list',
				body: 'Antifragile — Taleb\nThe Beginning of Infinity — Deutsch',
				color: 'blue',
				pinned: false,
				archived: false,
				trashed: false,
				trashedAt: null,
				createdAt: now - 2000,
				updatedAt: now - 2000,
				reminder: null,
				labels: []
			}
		];
	}
}

export const notesStore = new NotesStore();
