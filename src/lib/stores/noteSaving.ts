// Saving what a window changes into its workspace's database: notes with their
// photos, labels, and deletes. A change is journaled before its save starts and
// tried again when the save fails; the copy kept for a quicker start is written
// once changes pause. The store that holds the notes says what changed; how and
// when that reaches the database is decided here.
import type { Note, Label, NoteImage } from '#lib/types.js';
import { holdAttachmentWrites, saveNote, saveLabel, isProfileReleased } from '#lib/db/idb.js';
import { recordKey } from '#lib/syncRecords.js';
import {
	journalPendingNotes,
	noteForLocalStorage,
	noteNeedsDurableWrite,
	pendingLabels,
	pendingNoteDeletes,
	settlePendingNotes,
	writeLabelsMirror,
	writeNotesMirror,
	type PendingNotes
} from '#lib/noteStorage.js';
import { addTombstones, deleteLabelWithTombstone } from '#lib/syncTombstones.js';
import { prepareAttachmentForMemory } from '#lib/noteImages.js';
import { noteRecordKeys } from '#lib/syncEngine.js';
import { syncScheduler } from '#lib/stores/syncScheduler.js';
import { Retries, saveRetry } from '#lib/syncRetry.js';
import { type PendingChange } from '#lib/pendingJournal.js';

/** How long edits must pause before the fast-boot mirror catches up. */
const MIRROR_DELAY_MS = 2_000;

/** The window whose changes are saved. */
export interface SavingHost {
	/** The workspace the window shows. */
	pid(): string;
	/** The notes and labels it holds, as it holds them: a saved note is given back leaner. */
	notes(): Note[];
	labels(): Label[];
	/** False while what the window holds is older than the database, and is not to be written anywhere. */
	mayMirror(): boolean;
	/** A save went wrong, said where the person sees it; and one went through. */
	failed(context: string, err: unknown): void;
	saved(): void;
}

export class NoteSaving {
	constructor(private readonly host: SavingHost) {}

	/**
	 * Save a note and wait until it is in the database. Fails when it could not be
	 * saved, and the save is then tried again by itself.
	 */
	async saveNow(note: Note): Promise<void> {
		const pid = this.host.pid();
		const bytesLanded = this.holdWhileBytesLand(pid, note);
		this.journal([note]);
		this.scheduleMirror();
		try {
			await saveNote(pid, note, noteRecordKeys(note));
			settlePendingNotes({ [note.id]: noteForLocalStorage(note) }, pid);
			bytesLanded();
			// The window may show another workspace by now: this one is what was saved.
			if (pid === this.host.pid()) this.host.saved();
			syncScheduler.changed(pid);
		} catch (err) {
			this.host.failed(`Could not save note ${note.id}`, err);
			this.scheduleNoteRetry(note.id, bytesLanded);
			throw err;
		}
	}

	/** No note save waits to be tried again, and what those waits held is let go. */
	forgetNotes(): void {
		this.noteRetries.clear();
		for (const held of this.noteRetryHolds.values()) held.forEach((landed) => landed());
		this.noteRetryHolds.clear();
	}

	/**
	 * Save deletes of notes for good with their upload marks, in one step, on top of
	 * the deletes stored by then. They are journaled first: a stop before they land
	 * is replayed by the next start instead of bringing the notes back. The entry is
	 * taken out when the save ends either way: one that failed leaves the notes
	 * where they were, for the person to see, and must not delete them later.
	 */
	async saveNoteDeletes(pid: string, deletes: Record<string, number>) {
		if (!isProfileReleased(pid) && !pendingNoteDeletes.add(pid, deletes))
			console.error('[notes] could not journal unsaved deletes: localStorage write failed');
		try {
			return await addTombstones(
				pid,
				deletes,
				Object.keys(deletes).map((id) => recordKey('note-tombstone', id))
			);
		} finally {
			pendingNoteDeletes.settle(pid, deletes);
		}
	}

	/** No label save of this workspace waits to be tried again. */
	forgetUnsavedLabels(pid: string): void {
		const ofWorkspace = (slot: string) => slot.startsWith(`${pid}\n`);
		this.labelRetries.settleWhere(ofWorkspace);
		for (const slot of [...this.labelsAsked.keys()])
			if (ofWorkspace(slot)) this.labelsAsked.delete(slot);
	}

	/** Label saves that failed and wait to be tried again, by workspace and label. */
	private labelRetries = new Retries(saveRetry);
	/** What was last asked for each label that has not been saved yet, by workspace and label. */
	private labelsAsked = new Map<string, PendingChange<Label>>();

	/**
	 * Save a label, or its delete, with the upload marker in the same step. One that failed is tried again, later each time, whichever workspace the
	 * window shows by then: nothing else would save it before the next start. What is
	 * tried again is what was asked for last, whichever save failed last.
	 */
	writeLabel(
		pid: string,
		id: string,
		change: PendingChange<Label>,
		/** A start saving what it read from the journal: it is journaled already. */
		replayed = false
	): void {
		const slot = `${pid}\n${id}`;
		this.labelsAsked.set(slot, change);
		this.labelRetries.trying(slot);
		// Written before the save starts, so the change outlives a stop that comes first.
		// A replay writes nothing: another window may have journaled something newer since.
		if (!replayed && !isProfileReleased(pid) && !pendingLabels.add(pid, { [id]: change })) {
			const failure = new Error('localStorage write failed');
			if (pid === this.host.pid()) this.host.failed('Could not journal an unsaved label', failure);
			else console.error('[notes] Could not journal an unsaved label', failure);
		}
		const deleting = change.kind === 'delete';
		const saved: Promise<unknown> =
			change.kind === 'delete'
				? deleteLabelWithTombstone(pid, id, change.at, [recordKey('label-tombstone', id)])
				: saveLabel(pid, change.value, [recordKey('label', id)]);
		void saved.then(
			() => {
				pendingLabels.settle(pid, { [id]: change });
				if (pid === this.host.pid()) this.host.saved();
				if (this.labelsAsked.get(slot) === change) this.labelsAsked.delete(slot);
				// A later change that failed while this one was under way keeps its wait.
				this.labelRetries.succeeded(slot);
				syncScheduler.changed(pid);
			},
			(err) => {
				const failure = deleting ? 'Could not delete label' : 'Could not save label';
				if (pid === this.host.pid()) this.host.failed(failure, err);
				else console.error(`[notes] ${failure}`, err);
				const asked = this.labelsAsked.get(slot);
				if (isProfileReleased(pid) || asked === undefined) {
					this.labelsAsked.delete(slot);
					this.labelRetries.settled(slot);
				} else this.labelRetries.failed(slot, () => this.writeLabel(pid, id, asked, replayed));
			}
		);
	}

	/** Write the fast-boot mirror now: every note and label this window holds. */
	mirrorToLS() {
		this.cancelScheduledMirror();
		if (!this.host.mayMirror()) return;
		if (!writeNotesMirror(this.host.notes(), this.host.pid())) {
			this.host.failed(
				'Could not update the local notes mirror',
				new Error('localStorage write failed')
			);
		}
		writeLabelsMirror(this.host.labels(), this.host.pid());
	}

	mirrorLabels() {
		if (this.host.mayMirror()) writeLabelsMirror(this.host.labels(), this.host.pid());
	}

	private mirrorTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Refresh the fast-boot mirror once edits pause. Serializing every note on
	 * each save would cost a large workspace a long task per keystroke, and so
	 * would doing it every few seconds of steady typing. Crash safety does not
	 * wait for it: each edit is journaled before its write starts, and a hidden
	 * or closing page writes the mirror at once.
	 */
	scheduleMirror() {
		this.cancelScheduledMirror();
		const pid = this.host.pid();
		this.mirrorTimer = setTimeout(() => {
			this.mirrorTimer = null;
			// The window moved to another workspace; its own boot writes that mirror.
			if (pid === this.host.pid()) this.mirrorToLS();
		}, MIRROR_DELAY_MS);
	}

	cancelScheduledMirror() {
		if (this.mirrorTimer) clearTimeout(this.mirrorTimer);
		this.mirrorTimer = null;
	}

	/** Journal notes whose IndexedDB writes are about to start. */
	journal(notes: Note[]) {
		if (isProfileReleased(this.host.pid())) return;
		if (!journalPendingNotes(notes, this.host.pid())) {
			this.host.failed('Could not journal unsaved notes', new Error('localStorage write failed'));
		}
	}

	/** Note saves that failed and wait to be tried again, by note. */
	private noteRetries = new Retries(saveRetry);
	/** The holds on the attachment-writes lock that each waiting retry carries. */
	private noteRetryHolds = new Map<string, Array<() => void>>();
	/**
	 * Hold the attachment-writes lock for a write of this note that carries bytes,
	 * until the function returned is called. Asked for before the note is journaled:
	 * once another window can read that it lists new bytes, it can tell they have
	 * not landed.
	 */
	holdWhileBytesLand(pid: string, note: Note): () => void {
		return (note.images ?? []).some((image) => image.dataUrl)
			? holdAttachmentWrites(pid)
			: () => undefined;
	}

	/**
	 * Write the note again in a while. `bytesLanded` is the failed write's hold on
	 * the attachment-writes lock: the retry keeps that same hold, so a window already
	 * waiting to read what is stored goes on waiting until the bytes are in.
	 */
	scheduleNoteRetry(id: string, bytesLanded: () => void = () => undefined): void {
		this.noteRetryHolds.set(id, [...(this.noteRetryHolds.get(id) ?? []), bytesLanded]);
		this.noteRetries.failed(id, () => {
			const held = this.noteRetryHolds.get(id) ?? [];
			this.noteRetryHolds.delete(id);
			const allLanded = () => held.forEach((landed) => landed());
			const note = this.host.notes().find((item) => item.id === id);
			if (!note) {
				this.noteRetries.succeeded(id);
				return allLanded();
			}
			const pid = this.host.pid();
			saveNote(pid, note, noteRecordKeys(note))
				.then(() => {
					settlePendingNotes({ [id]: noteForLocalStorage(note) }, pid);
					// A write that failed while this one was under way keeps its own wait.
					this.noteRetries.succeeded(id);
					this.host.saved();
					syncScheduler.changed(pid);
					allLanded();
				})
				.catch((err) => {
					this.host.failed(`Could not retry note ${id}`, err);
					this.scheduleNoteRetry(id, allLanded);
				});
		});
	}

	/** Replay localStorage notes/labels that never landed in IndexedDB after a crash. */
	async recoverMirrorIntoIndexedDB(
		dbNotes: Note[],
		dbLabels: Label[],
		/** Labels something else saves in this load. */
		skipLabels: ReadonlySet<string> = new Set()
	): Promise<void> {
		const dbById = new Map(dbNotes.map((item) => [item.id, item]));
		for (const item of this.host.notes()) {
			if (noteNeedsDurableWrite(dbById.get(item.id), item))
				await saveNote(this.host.pid(), item, noteRecordKeys(item));
		}
		const dbLabelById = new Map(dbLabels.map((item) => [item.id, item]));
		for (const label of this.host.labels()) {
			if (skipLabels.has(label.id)) continue;
			const current = dbLabelById.get(label.id);
			if (current && current.name === label.name && current.updatedAt === label.updatedAt) continue;
			await saveLabel(this.host.pid(), label, [recordKey('label', label.id)]);
		}
	}

	persist(id: string) {
		this.persistNotes([id]);
	}

	persistNotes(ids: string[]) {
		const wanted = new Set(ids);
		const notes = this.host.notes().filter((note) => wanted.has(note.id));
		if (notes.length === 0) return;
		const pid = this.host.pid();
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
		syncScheduler.changed(pid);
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
		return saveNote(pid, note, noteRecordKeys(note)).then(
			async () => {
				// The bytes are in the database, so whoever waits to read them goes on,
				// whatever has become of the note in this window meanwhile.
				bytesLanded();
				if (pid !== this.host.pid()) return true;
				this.host.saved();
				await this.letGoOfSavedBytes(pid, id, written).catch((err) =>
					console.error('[notes] could not shrink saved photos in memory', err)
				);
				return true;
			},
			(err) => {
				this.host.failed(`Could not save note ${id}`, err);
				this.scheduleNoteRetry(id, bytesLanded);
				return false;
			}
		);
	}

	/**
	 * Keep only small previews in memory of the photos a save has put in the
	 * database. Making them takes a while, and the note may have moved in the list,
	 * left it, or got another photo under the same id meanwhile: it is found again,
	 * and only a photo that is still the one that was saved is swapped.
	 */
	private async letGoOfSavedBytes(pid: string, id: string, written: Set<string>): Promise<void> {
		const before = this.host.notes().find((item) => item.id === id);
		if (!before) return;
		const lean = new Map<NoteImage, NoteImage>();
		await Promise.all(
			(before.images ?? [])
				.filter((image) => written.has(image.id))
				.map(async (image) => lean.set(image, await prepareAttachmentForMemory(image)))
		);
		if (pid !== this.host.pid()) return;
		const idx = this.host.notes().findIndex((item) => item.id === id);
		if (idx < 0) return;
		const current = this.host.notes()[idx];
		const images = (current.images ?? []).map((image) => lean.get(image) ?? image);
		if (images.some((image, i) => image !== current.images?.[i])) {
			this.host.notes()[idx] = { ...current, images };
			this.scheduleMirror();
		}
	}
}
