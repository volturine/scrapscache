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
import { isProfileReleased } from '#lib/db/idb.js';
import { dropNotesMirror } from '#lib/noteStorage.js';
import { PendingJournal, type Pending } from '#lib/pendingJournal.js';
import { Retries, saveRetry } from '#lib/syncRetry.js';
import { syncStore } from '#lib/stores/sync.svelte.js';

/** Library items whose save has not landed: the item, or the time it was removed. */
const pendingLibrary = new PendingJournal<CanvasLibraryEntry | number>(
	'scrapscache-library-pending',
	dropNotesMirror
);

function sanitizeTombstones(value: unknown): Record<string, number> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).flatMap(([id, at]) => (Number(at) > 0 ? [[id, Number(at)]] : []))
	);
}

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
	private saveRetries = new Retries(saveRetry);
	private owed = new Map<string, Set<string>>();

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
		const unsaved = pendingLibrary.read(pid);
		const tombstones = { ...stored.tombstones };
		const keys: string[] = [];
		const items: CanvasLibraryEntry[] = [];
		for (const [id, change] of Object.entries(unsaved)) {
			if (typeof change !== 'number') {
				items.push(change);
				keys.push(`library-item:${id}`);
			} else if (change > (tombstones[id] || 0)) {
				tombstones[id] = change;
				keys.push(`library-item-tombstone:${id}`);
			}
		}
		this.entries = mergeCanvasLibrary(stored.entries, items, tombstones);
		this.tombstones = tombstones;
		this.notify();
		if (keys.length) {
			this.persist(pid, keys, unsaved);
			syncStore.requestAutoSync([]);
		} else pendingLibrary.settle(pid, unsaved);
	}

	/** No save of this workspace's library waits to be tried again. The journal keeps what it has. */
	forgetUnsaved(pid: string): void {
		this.owed.delete(pid);
		this.saveRetries.settled(pid);
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
			keys.push(`library-item:${item.id}`);
		}
		for (const id of removals) {
			const existing = byId.get(id);
			if (!existing) continue;
			tombstones[id] = Math.max(syncClock.now(), existing.updatedAt + 1);
			byId.delete(id);
			keys.push(`library-item-tombstone:${id}`);
		}
		if (!keys.length) return;
		this.revision += 1;
		this.entries = [...byId.values()];
		this.tombstones = tombstones;
		this.notify();
		this.persist(this.pid, keys);
		syncStore.requestAutoSync([]);
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
		replayed?: Pending<CanvasLibraryEntry | number>
	): void {
		const marks = [...new Set([...(this.owed.get(pid) ?? []), ...keys])];
		this.owed.delete(pid);
		this.saveRetries.trying(pid);
		const entries = plain(this.entries);
		const tombstones = { ...this.tombstones };
		// A replay writes nothing: another window may have journaled something newer since.
		const changes: Pending<CanvasLibraryEntry | number> = replayed ?? {};
		for (const key of replayed ? [] : marks) {
			const id = key.slice(key.indexOf(':') + 1);
			// An item that is here was put back after its removal, so it is the newer of the two.
			const entry = entries.find((candidate) => candidate.id === id);
			if (entry) changes[id] = entry;
			else if (tombstones[id]) changes[id] = tombstones[id];
		}
		if (!replayed && !isProfileReleased(pid) && !pendingLibrary.add(pid, changes))
			console.error(
				'[canvas library] could not journal unsaved changes: localStorage write failed'
			);
		const generation = this.generation;
		const revision = this.revision;
		const write = this.pendingWrites.then(async () => {
			const stored = await mergeStoredCanvasLibrary(pid, entries, tombstones, marks);
			// Everything journaled for these marks is saved, a change that lost to a newer one included.
			pendingLibrary.settle(pid, changes);
			this.saveRetries.succeeded(pid);
			if (pid === this.pid && generation === this.generation && revision === this.revision)
				this.applySync(stored.entries, stored.tombstones);
		});
		this.pendingWrites = write.catch((err) => {
			console.error('[canvas library] could not save the library:', err);
			this.owed.set(pid, new Set([...(this.owed.get(pid) ?? []), ...marks]));
			this.saveRetries.failed(pid, () => {
				if (pid === this.pid) {
					this.persist(pid, []);
					syncStore.requestAutoSync([]);
				} else {
					this.owed.delete(pid);
					this.saveRetries.settled(pid);
				}
			});
		});
	}

	private notify(): void {
		const items = this.items();
		for (const listener of this.listeners) listener(items);
	}
}

export const canvasLibraryStore = new CanvasLibraryStore();
