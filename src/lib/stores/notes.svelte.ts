// Rune-based notes & labels store. Persists to IndexedDB from explicit write paths.
import type { Note, Label, NoteColor, NoteImage } from '#lib/types.js';
import { activeFilterCount, matchesFilters, NO_FILTERS, type SearchFilters } from '#lib/search.js';
import {
	getAllNotesMetadata,
	getStoredAttachmentVersions,
	hydrateNoteAttachments,
	mergeNote,
	deleteNote,
	getAllLabels,
	bulkPutNotes,
	pruneOrphanImageBlobs,
	isProfileReleased
} from '#lib/db/idb.js';
import {
	applyNoteEdit,
	mergeLabelLists,
	mergeNoteLists,
	reminderShownAt,
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
import { relay } from '#lib/relayClient.js';
import { clearBoardsMirror, kanbanStore } from '#lib/stores/kanban.svelte.js';
import { actionUndo } from '#lib/stores/actionUndo.svelte.js';
import { composerStore } from '#lib/stores/composer.svelte.js';
import { canvasLibraryStore } from '#lib/stores/canvasLibrary.js';
import { reminderHistoryStore } from '#lib/stores/reminderHistory.js';
import type { SyncSnapshot } from '#lib/syncRecords.js';
import { recordKey } from '#lib/syncRecords.js';
import { uiStore } from '#lib/stores/ui.svelte.js';
import { trashPurgeAt, cloneNote } from '#lib/utils.js';
import { appClock } from '#lib/appClock.svelte.js';
import { noteAttachments, toggleLineAt } from '#lib/checklistBody.js';
import { bodyHasPhotoMarker, parsePhotoMarker, stripPhotoMarkers } from '#lib/photoMarker.js';
import { joinWrappedHttpUrls } from '#lib/linkPreview.js';
import {
	noteNeedsDurableWrite,
	readLabelsMirror,
	pendingLabels,
	pendingNoteDeletes,
	readNotesMirror,
	readPendingNotes,
	settlePendingNotes
} from '#lib/noteStorage.js';
import { addTombstones, newestTombstones, readStoredTombstones } from '#lib/syncTombstones.js';
import {
	ensureAttachmentPreview,
	prepareAttachmentForMemory,
	stripFullPreviewBytes
} from '#lib/noteImages.js';
import { isCanvasAttachment } from '#lib/canvasAttachment.js';
import { formatStorageError } from '#lib/imageBlob.js';
import { type ScrapsCacheBackup } from '#lib/backup.js';
import { noteRecordKeys } from '#lib/syncEngine.js';
import { syncScheduler } from '#lib/stores/syncScheduler.js';
import { NoteSaving } from '#lib/stores/noteSaving.js';
import { clearPendingJournals } from '#lib/pendingJournal.js';
import { localWritesLanded } from '#lib/localWrites.js';
import { withWorkspaceLock } from '#lib/webLock.js';
import { readWorkspace } from '#lib/workspaceSync.js';

/** What deleting a label with its notes changes on each note. */
type NoteTrashState = Pick<Note, 'id' | 'trashed' | 'trashedAt' | 'pinned' | 'archived'>;

export { noteNeedsDurableWrite };

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

	notes = $state<Note[]>([]);
	labels = $state<Label[]>([]);
	loaded = $state(false);
	lastPersistError = $state<string | null>(null);
	deletedNoteIds = $state<Record<string, number>>({});
	deletedLabelIds = $state<Record<string, number>>({});
	/** How what this window changes reaches the database: see `noteSaving.ts`. */
	readonly saving = new NoteSaving({
		pid: () => this.pid,
		notes: () => this.notes,
		labels: () => this.labels,
		mayMirror: () => this.mayMirror(),
		failed: (context, err) => this.recordPersistenceError(context, err),
		saved: () => (this.lastPersistError = null)
	});
	private attachmentLoads = new Map<string, Promise<void>>();
	private attachmentWork = new Set<Promise<void>>();
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
		syncScheduler.whenSynced((pid, saved) => this.show(pid, saved));
		syncScheduler.whenRewritten((pid) => this.showRewritten(pid));
		if (this.notes.length > 0) this.loaded = true;
		if (typeof window !== 'undefined') {
			window.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'hidden') this.saving.mirrorToLS();
				else if (this.rewrittenWhileHidden === this.pid) void this.showRewritten(this.pid);
				else if (this.staleWhileHidden === this.pid) void this.show(this.pid);
			});
			window.addEventListener('pagehide', () => this.saving.mirrorToLS());
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
		this.rewrittenWhileHidden = null;
		await syncStore.ensureProfilesLoaded();

		// One read of the journal: these are the entries this boot replays, so only
		// these may be settled. Another window may journal more while this awaits.
		const pending = readPendingNotes(this.pid);
		const loadedFor = this.pid;
		const unsavedLabels = pendingLabels.read(loadedFor);
		const unsavedNoteDeletes = pendingNoteDeletes.read(loadedFor);
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
		// A label change whose save never landed is laid over what is stored: the label
		// as it was changed, or the time it was deleted.
		const labels = mergeLabelLists(
			mergeLabelLists(mirrorLabels, dbLabels),
			Object.values(unsavedLabels).flatMap((change) =>
				change.kind === 'put' ? [change.value] : []
			)
		).sort((a, b) => a.name.localeCompare(b.name));
		const unsavedLabelDeletes = Object.fromEntries(
			Object.entries(unsavedLabels).flatMap(([id, change]) =>
				change.kind === 'delete' ? [[id, change.at]] : []
			)
		);
		const seededFlag =
			typeof localStorage !== 'undefined' ? localStorage.getItem('scrapscache-seeded') : null;

		const tombstones = await readStoredTombstones(this.pid).catch(() => ({
			notes: this.deletedNoteIds,
			labels: this.deletedLabelIds,
			boards: {}
		}));
		// A delete for good that never landed stands for a note still in the trash as
		// it was then: one restored or changed since is kept.
		const owedNoteDeletes = Object.fromEntries(
			Object.entries(unsavedNoteDeletes).filter(([id, deletedAt]) => {
				const note = notes.find((candidate) => candidate.id === id);
				return note?.trashed === true && note.updatedAt <= deletedAt;
			})
		);
		this.deletedNoteIds = newestTombstones(tombstones.notes, owedNoteDeletes);
		this.deletedLabelIds = newestTombstones(tombstones.labels, unsavedLabelDeletes);
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
			this.saving.mirrorToLS();
			try {
				await bulkPutNotes(this.pid, this.notes);
			} catch (err) {
				this.recordPersistenceError('Could not save starter notes', err);
			}
		} else {
			this.notes = withoutTombstoned(notes, this.deletedNoteIds);
			this.labels = withoutTombstoned(labels, this.deletedLabelIds);
			this.saving.mirrorToLS();
			if (!deviceReadFailed) {
				try {
					// The labels the journal names are saved by its replay below, once.
					await this.saving.recoverMirrorIntoIndexedDB(
						dbNotes,
						dbLabels,
						new Set(Object.keys(unsavedLabels))
					);
					// Every edit journaled before this boot read the journal is in IndexedDB now.
					settlePendingNotes(pending, this.pid);
					// Each label change left unsaved is saved as it would have been, unless the
					// window has moved on: its journal then waits for this workspace's next load.
					if (loadedFor === this.pid) {
						for (const [id, change] of Object.entries(unsavedLabels)) {
							// Deleted since the change was journaled: the delete stands.
							if (change.kind === 'put' && this.deletedLabelIds[id])
								pendingLabels.settle(loadedFor, { [id]: change });
							else this.saving.writeLabel(loadedFor, id, change, true);
						}
						if (Object.keys(owedNoteDeletes).length) {
							const stored = await addTombstones(
								loadedFor,
								owedNoteDeletes,
								Object.keys(owedNoteDeletes).map((id) => recordKey('note-tombstone', id))
							);
							reminderHistoryStore.forgetNotes(loadedFor, stored);
							await Promise.all(
								Object.keys(owedNoteDeletes).map((id) => deleteNote(loadedFor, id))
							);
						}
						// What the journal held when this load read it is deleted now, or was
						// a delete of something restored since.
						pendingNoteDeletes.settle(loadedFor, unsavedNoteDeletes);
					}
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
			// Decided for the copy stored by then, which another window may have saved since.
			await mergeNote(
				pid,
				settled,
				(stored) => (stored ? withAttachmentDecisions(stored, decisions) : null),
				noteRecordKeys(settled)
			);
		}
		this.saving.scheduleMirror();
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
		await this.saving.saveNow(this.notes[idx]);
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
		this.saving.persist(note.id);
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
		this.saving.persist(id);
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
		this.reminderChanged();
	}

	/**
	 * A reminder was set, moved or cleared. Another device has to know before it is
	 * due, so it is sent now, not after the pause that typing gets.
	 */
	reminderChanged(): void {
		void syncScheduler.request(this.pid);
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
		this.reminderChanged();
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
		const stored = await this.saving.saveNoteDeletes(pid, { [id]: Date.now() });
		reminderHistoryStore.forgetNotes(pid, stored);
		if (pid === this.pid) {
			this.deletedNoteIds = newestTombstones(this.deletedNoteIds, stored);
			this.notes = this.notes.filter((n) => n.id !== id);
			// The tombstone is on disk, so a mirror that still lists the note cannot bring it back.
			this.saving.scheduleMirror();
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
		this.saving.mirrorLabels();
		this.persistLabel(label.id);
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
		this.saving.mirrorLabels();
		this.persistLabel(renamed.id);
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
			this.saving.mirrorLabels();
			this.saving.persistNotes(affected.map((note) => note.id));
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
			this.saving.mirrorLabels();
			this.saving.persistNotes(affectedNoteIds);
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

	// Reload all three layers. Mirror is only a fast-boot cache; IDB always participates so
	// image blobs are rehydrated even when a mirror exists.
	/**
	 * Point the in-memory state at another profile's namespace. Datasets live
	 * in separate IDB namespaces, so this only drops pending writes belonging
	 * to the previous profile and reloads from storage.
	 */
	async reloadForProfile(): Promise<void> {
		actionUndo.clear();
		this.saving.cancelScheduledMirror();
		this.saving.forgetNotes();
		this.attachmentLoads.clear();
		this.visibleAttachmentQueue.clear();
		this.lastPersistError = null;
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
		while (this.attachmentLoads.size > 0) {
			await Promise.allSettled([...this.attachmentLoads.values()]);
		}
		await localWritesLanded(this.pid);
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
		const stored = await this.saving.saveNoteDeletes(
			pid,
			Object.fromEntries(ids.map((id) => [id, deletedAt]))
		);
		reminderHistoryStore.forgetNotes(pid, stored);
		if (pid === this.pid) {
			this.deletedNoteIds = newestTombstones(this.deletedNoteIds, stored);
			this.notes = this.notes.filter((n) => !ids.includes(n.id));
			this.saving.scheduleMirror();
		}
		syncScheduler.changed(pid);
		await Promise.all(ids.map((id) => deleteNote(pid, id)));
	}

	/**
	 * A workspace was replaced whole: nothing from before that waits to be saved, or
	 * to be saved again, comes back into it.
	 */
	forgetUnsaved(pid: string): void {
		clearBoardsMirror(pid);
		canvasLibraryStore.forgetUnsaved(pid);
		this.saving.forgetUnsavedLabels(pid);
		if (pid === this.pid) this.saving.forgetNotes();
		clearPendingJournals(pid);
	}

	private markLabelsDeleted(ids: string[], deletedAt = Date.now()): void {
		if (ids.length === 0) return;
		const next = { ...this.deletedLabelIds };
		for (const id of ids) next[id] = deletedAt;
		this.deletedLabelIds = next;
		for (const id of ids) this.persistLabel(id);
	}

	/** Save a label as this window holds it now, or its delete. */
	private persistLabel(id: string): void {
		const label = this.labels.find((item) => item.id === id);
		const deletedAt = this.deletedLabelIds[id];
		if (label) this.saving.writeLabel(this.pid, id, { kind: 'put', value: { ...label } });
		else if (deletedAt) this.saving.writeLabel(this.pid, id, { kind: 'delete', at: deletedAt });
	}

	private mayMirror(): boolean {
		// A workspace removed in another window keeps no mirror either: writing
		// one back would leave note text behind for a workspace that is gone.
		if (isProfileReleased(this.pid)) return false;
		// Another window has written newer notes than this one holds, or rewrote the
		// workspace: what this window holds is not to be written anywhere until it has read.
		return this.staleWhileHidden !== this.pid && this.rewrittenWhileHidden !== this.pid;
	}

	/** A save or a load of the open workspace went wrong: it is said where the person sees it. */
	recordPersistenceError(context: string, err: unknown): void {
		const detail = formatStorageError(err);
		this.lastPersistError = `${context}: ${detail}`;
		console.error(`[notes] ${context}`, err);
	}

	/** The workspace another window synced while this one was hidden and skipped re-reading. */
	private staleWhileHidden: string | null = null;
	/** The workspace another window rewrote while this one was hidden. */
	private rewrittenWhileHidden: string | null = null;

	private async notesForMemory(notes: Note[]): Promise<Note[]> {
		return Promise.all(
			notes.map(async (note) => ({
				...note,
				images: await Promise.all((note.images ?? []).map(prepareAttachmentForMemory))
			}))
		);
	}

	/**
	 * Another window rewrote the workspace this one shows: an import, or replacing
	 * the cloud copy. A rewrite takes things away as well as adding them, so nothing
	 * this window holds is merged with it: the workspace is loaded again from what
	 * landed, once this window's own saves are in. A hidden window waits until it is
	 * shown, and mirrors nothing meanwhile.
	 */
	private async showRewritten(pid: string): Promise<void> {
		if (pid !== this.pid) return;
		if (document.visibilityState === 'hidden') {
			this.rewrittenWhileHidden = pid;
			this.staleWhileHidden = pid;
			return;
		}
		this.rewrittenWhileHidden = null;
		await withWorkspaceLock(async () => {
			if (pid !== this.pid || isProfileReleased(pid)) return;
			await this.waitForPendingProfileWrites();
			await this.reloadForProfile();
		}).catch((err) =>
			this.recordPersistenceError('Could not show what another window landed', err)
		);
	}

	/**
	 * Something else saved into the database of the workspace this window shows:
	 * memory takes what it brought. A sync that ran here hands over what it saved;
	 * after a save in another window the database is read. Nothing is written here.
	 * Every save merges with what is stored, so an edit made meanwhile is in the
	 * database with what was saved, whichever of the two landed first.
	 *
	 * The browser may freeze a hidden window in the middle of a read, and its open
	 * transactions then hold every other window's writes to this workspace until it
	 * thaws. A hidden window has nothing to show, so it reads once it is shown again,
	 * or when a sync of its own lands.
	 */
	private async show(
		pid: string,
		synced?: { snapshot: SyncSnapshot; decisions: AttachmentDecisions }
	): Promise<void> {
		// Noted at once, before anything is waited for: until it has read, this window
		// holds older notes than the database and must not mirror them.
		if (!synced && pid === this.pid && document.visibilityState === 'hidden') {
			this.staleWhileHidden = pid;
			return;
		}
		// Another window rewrote this workspace and this one has not loaded it again
		// yet: what it holds is from before, and nothing is merged into that. The load
		// that follows, once the window is shown, reads what this sync saved too.
		if (pid === this.pid && this.rewrittenWhileHidden === pid) return;
		// A load under way read the database before or after this was saved: either
		// way what was saved is merged into what it loaded.
		await this.boot;
		if (pid !== this.pid || !this.loaded) return;
		let saved = synced?.snapshot;
		if (!saved || this.staleWhileHidden === pid) {
			this.staleWhileHidden = null;
			try {
				// What a sync here saved is part of what the database holds.
				saved = await readWorkspace(pid);
				if (pid !== this.pid) return;
				await reminderHistoryStore.hydrate(pid);
			} catch (err) {
				this.recordPersistenceError('Could not read what another window saved', err);
				if (!saved) return;
			}
		}
		const decisions: AttachmentDecisions = synced?.decisions ?? new Map();
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
		this.notes = withoutTombstoned(mergeNoteLists(this.notes, lean), tombstones)
			.map((note) => withoutSavedBytes(withAttachmentDecisions(note, decisions)))
			.sort((a, b) => b.updatedAt - a.updatedAt);
		this.labels = withoutTombstoned(
			mergeLabelLists(this.labels, saved.labels),
			labelTombstones
		).sort((a, b) => a.name.localeCompare(b.name));
		this.deletedNoteIds = tombstones;
		this.deletedLabelIds = labelTombstones;
		kanbanStore.applySync(saved.boards, saved.boardTombstones);
		canvasLibraryStore.applySync(saved.libraryItems, saved.libraryTombstones);
		this.saving.scheduleMirror();
		if (synced) this.lastPersistError = null;
		this.onAfterSync?.();
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
