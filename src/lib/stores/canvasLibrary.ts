import {
	diffCanvasLibrary,
	libraryItemsFor,
	mergeCanvasLibrary,
	mergeStoredCanvasLibrary,
	readCanvasLibrary,
	type CanvasLibraryEntry,
	type CanvasLibraryItem
} from '#lib/canvasLibrary.js';
import { syncClock } from '#lib/editContext.js';
import { recordKey } from '#lib/syncRecords.js';
import { dropNotesMirror } from '#lib/noteStorage.js';
import { PendingJournal, type Pending, type PendingChange } from '#lib/pendingJournal.js';
import { UnsavedChanges } from '#lib/unsavedChanges.js';
import { trackLocalWrites } from '#lib/localWrites.js';
import { sanitizeTombstones } from '#lib/syncTombstones.js';
import { syncScheduler } from '#lib/stores/syncScheduler.js';

/** Library items whose save has not landed: the item, or the time it was removed. */
const pendingLibrary = new PendingJournal<PendingChange<CanvasLibraryEntry>>(
	'scrapscache-library-pending',
	dropNotesMirror
);

/** IndexedDB cannot store frozen editor objects that carry `undefined`; JSON is the stored shape. */
function plain<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/** The active workspace's canvas shape library. */
export class CanvasLibraryStore {
	private pid = '';
	private entries: CanvasLibraryEntry[] = [];
	private tombstones: Record<string, number> = {};
	private generation = 0;
	private revision = 0;
	private listeners = new Set<(items: CanvasLibraryItem[]) => void>();
	private pendingWrites: Promise<void> = Promise.resolve();
	/** Saves that failed and wait to be tried again, by workspace, with the upload marks they owe. */
	private unsaved = new UnsavedChanges(pendingLibrary, 'canvas library items');

	/** Load a workspace's library. Nothing of the previous workspace's survives the switch. */
	async hydrate(pid: string): Promise<void> {
		const generation = ++this.generation;
		// What this window saved last must be on disk before it is read back.
		await this.pendingWrites;
		if (generation !== this.generation) return;
		this.pid = pid;
		this.entries = [];
		this.tombstones = {};
		const stored = await readCanvasLibrary(pid);
		if (generation !== this.generation) return;
		// Changes whose save never landed are laid over what is stored and saved again.
		const unsaved = this.unsaved.read(pid);
		const tombstones = { ...stored.tombstones };
		const keys: string[] = [];
		const items: CanvasLibraryEntry[] = [];
		for (const [id, change] of Object.entries(unsaved)) {
			if (change.kind === 'put') {
				items.push(change.value);
				keys.push(recordKey('library-item', id));
			} else if (change.at > (tombstones[id] || 0)) {
				tombstones[id] = change.at;
				keys.push(recordKey('library-item-tombstone', id));
			}
		}
		this.entries = mergeCanvasLibrary(stored.entries, items, tombstones);
		this.tombstones = tombstones;
		this.notify();
		if (keys.length) {
			this.persist(pid, keys, unsaved);
			syncScheduler.changed(pid);
		} else this.unsaved.settle(pid, unsaved);
	}

	/** No save of this workspace's library waits to be tried again. The journal keeps what it has. */
	forgetUnsaved(pid: string): void {
		this.unsaved.forget(pid);
	}

	items(): CanvasLibraryItem[] {
		return libraryItemsFor(this.entries);
	}

	/** Hear about every change to the library, including ones another device made. */
	subscribe(listener: (items: CanvasLibraryItem[]) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Record what an open editor changed. It is compared with what that editor
	 * last showed, not with this store: an item that arrived from another device
	 * while the editor was open is not one the editor removed.
	 */
	applyEditorChange(previous: readonly unknown[], next: readonly unknown[]): void {
		const { upserts, removals } = diffCanvasLibrary(previous, next);
		const byId = new Map(this.entries.map((entry) => [entry.id, entry]));
		const tombstones = { ...this.tombstones };
		const keys: string[] = [];
		for (const item of upserts) {
			const updatedAt = Math.max(
				syncClock.now(),
				(byId.get(item.id)?.updatedAt ?? 0) + 1,
				(tombstones[item.id] ?? 0) + 1
			);
			byId.set(item.id, { id: item.id, updatedAt, item: plain(item) });
			keys.push(recordKey('library-item', item.id));
		}
		for (const id of removals) {
			const existing = byId.get(id);
			if (!existing) continue;
			tombstones[id] = Math.max(syncClock.now(), existing.updatedAt + 1);
			byId.delete(id);
			keys.push(recordKey('library-item-tombstone', id));
		}
		if (!keys.length) return;
		this.revision += 1;
		this.entries = [...byId.values()];
		this.tombstones = tombstones;
		this.notify();
		this.persist(this.pid, keys);
		syncScheduler.changed(this.pid);
	}

	/** Merge what a sync pulled without scheduling another upload. */
	applySync(remote: CanvasLibraryEntry[], remoteTombstones: Record<string, number>): void {
		const tombstones = { ...this.tombstones };
		for (const [id, deletedAt] of Object.entries(sanitizeTombstones(remoteTombstones))) {
			if (deletedAt > (tombstones[id] || 0)) tombstones[id] = deletedAt;
		}
		this.set(mergeCanvasLibrary(this.entries, remote, tombstones), tombstones);
	}

	waitForPendingWrites(): Promise<void> {
		return this.pendingWrites;
	}

	private set(entries: CanvasLibraryEntry[], tombstones: Record<string, number>): void {
		this.revision += 1;
		this.entries = entries;
		this.tombstones = tombstones;
		this.notify();
	}

	/**
	 * Save the library with the upload marks for `keys`. The changes are journaled
	 * before the save starts, so they outlive a stop that comes first. A save that
	 * failed is tried again, later each time, with every mark the failed ones owed,
	 * for as long as the window shows that workspace; whichever it shows, the journal
	 * has the change for the next start.
	 */
	private persist(
		pid: string,
		keys: string[],
		/** What a start read from the journal and saves again: it is journaled already. */
		replayed?: Pending<PendingChange<CanvasLibraryEntry>>
	): void {
		const marks = this.unsaved.begin(pid, keys);
		const entries = plain(this.entries);
		const tombstones = { ...this.tombstones };
		// A replay journals nothing: another window may have journaled something newer since.
		const changes =
			replayed ??
			this.unsaved.journalFor(pid, marks, (id): PendingChange<CanvasLibraryEntry> | undefined => {
				// An item that is here was put back after its removal, so it is the newer of the two.
				const entry = entries.find((candidate) => candidate.id === id);
				if (entry) return { kind: 'put', value: entry };
				return tombstones[id] ? { kind: 'delete', at: tombstones[id] } : undefined;
			});
		const generation = this.generation;
		const revision = this.revision;
		const write = this.pendingWrites.then(async () => {
			const stored = await mergeStoredCanvasLibrary(pid, entries, tombstones, marks);
			// Everything journaled for these marks is saved, a change that lost to a newer one included.
			this.unsaved.settle(pid, changes);
			this.unsaved.succeeded(pid);
			if (pid === this.pid && generation === this.generation && revision === this.revision)
				this.applySync(stored.entries, stored.tombstones);
		});
		this.pendingWrites = write.catch((err) => {
			console.error('[canvas library] could not save the library:', err);
			this.unsaved.failed(pid, marks, () => {
				if (pid === this.pid) {
					this.persist(pid, []);
					syncScheduler.changed(pid);
				} else this.unsaved.forget(pid);
			});
		});
	}

	private notify(): void {
		const items = this.items();
		for (const listener of this.listeners) listener(items);
	}
}

export const canvasLibraryStore = new CanvasLibraryStore();
trackLocalWrites(() => canvasLibraryStore.waitForPendingWrites());
