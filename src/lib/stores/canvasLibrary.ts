import {
	CANVAS_LIBRARY_STATE_KEY,
	CANVAS_LIBRARY_TOMBSTONES_KEY,
	diffCanvasLibrary,
	isCanvasLibraryItem,
	isCanvasLibraryEntry,
	libraryItemsFor,
	mergeCanvasLibrary,
	readCanvasLibrary,
	type CanvasLibraryEntry,
	type CanvasLibraryItem
} from '$lib/canvasLibrary';
import { mergeWorkspaceState } from '$lib/db/idb';
import { syncClock } from '$lib/editContext';
import { syncStore } from '$lib/stores/sync.svelte';
import { BackupImportMode } from '$lib/backup';

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
	private replacePending = false;
	private listeners = new Set<(items: CanvasLibraryItem[]) => void>();
	private pendingWrites: Promise<void> = Promise.resolve();

	/** Load a workspace's library. Nothing of the previous workspace's survives the switch. */
	async hydrate(pid: string): Promise<void> {
		const generation = ++this.generation;
		// What this window saved last must be on disk before it is read back.
		await this.pendingWrites;
		if (generation !== this.generation) return;
		this.pid = pid;
		this.entries = [];
		this.tombstones = {};
		this.replacePending = false;
		const stored = await readCanvasLibrary(pid);
		if (generation !== this.generation) return;
		this.entries = stored.entries;
		this.tombstones = stored.tombstones;
		this.notify();
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

	/**
	 * Bring a backup's library into this workspace as a new save of each item, so
	 * it wins over any older version or delete elsewhere. Keep adds what is
	 * missing; Replace also deletes what the backup does not have.
	 */
	restore(pid: string, items: readonly unknown[], mode: BackupImportMode): void {
		if (pid !== this.pid) return;
		const now = syncClock.now();
		const byId = new Map(this.entries.map((entry) => [entry.id, entry]));
		const tombstones = { ...this.tombstones };
		const keys: string[] = [];
		const restored = new Set<string>();
		for (const item of items.filter(isCanvasLibraryItem)) {
			restored.add(item.id);
			const current = byId.get(item.id);
			if (current && mode === BackupImportMode.Keep) continue;
			const updatedAt = Math.max(
				now,
				(current?.updatedAt ?? 0) + 1,
				(tombstones[item.id] ?? 0) + 1
			);
			byId.set(item.id, { id: item.id, updatedAt, item: plain(item) });
			keys.push(`library-item:${item.id}`);
		}
		if (mode === BackupImportMode.Replace) {
			for (const [id, entry] of byId) {
				if (restored.has(id)) continue;
				tombstones[id] = Math.max(now, entry.updatedAt + 1);
				byId.delete(id);
				keys.push(`library-item-tombstone:${id}`);
			}
		}
		if (!keys.length) return;
		this.set([...byId.values()], tombstones);
		this.persist(pid, keys);
	}

	entriesForSync(): CanvasLibraryEntry[] {
		return this.entries.map((entry) => ({ ...entry }));
	}

	tombstonesForSync(): Record<string, number> {
		return { ...this.tombstones };
	}

	/** Merge what a sync pulled without scheduling another upload. */
	applySync(remote: CanvasLibraryEntry[], remoteTombstones: Record<string, number>): void {
		const tombstones = { ...this.tombstones };
		for (const [id, deletedAt] of Object.entries(sanitizeTombstones(remoteTombstones))) {
			if (deletedAt > (tombstones[id] || 0)) tombstones[id] = deletedAt;
		}
		this.set(mergeCanvasLibrary(this.entries, remote, tombstones), tombstones);
	}

	/** Used when this device takes the cloud's copy instead of its own. */
	replaceWithCloud(remote: CanvasLibraryEntry[], remoteTombstones: Record<string, number>): void {
		this.replacePending = true;
		const tombstones = sanitizeTombstones(remoteTombstones);
		this.set(mergeCanvasLibrary([], remote, tombstones), tombstones);
	}

	async persistSyncState(pid: string, syncOutboxKeys: Iterable<string> = []): Promise<void> {
		if (pid !== this.pid) return;
		this.persist(pid, [...syncOutboxKeys]);
		await this.pendingWrites;
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

	private persist(pid: string, keys: string[]): void {
		const entries = plain(this.entries);
		const tombstones = { ...this.tombstones };
		const generation = this.generation;
		const revision = this.revision;
		const replace = this.replacePending;
		this.replacePending = false;
		const write = this.pendingWrites.then(async () => {
			const state = await mergeWorkspaceState(
				pid,
				[CANVAS_LIBRARY_STATE_KEY, CANVAS_LIBRARY_TOMBSTONES_KEY],
				(current) => {
					const deleted = sanitizeTombstones(replace ? {} : current[CANVAS_LIBRARY_TOMBSTONES_KEY]);
					for (const [id, at] of Object.entries(tombstones))
						deleted[id] = Math.max(deleted[id] ?? 0, at);
					const stored = replace ? [] : current[CANVAS_LIBRARY_STATE_KEY];
					return {
						value: {
							[CANVAS_LIBRARY_STATE_KEY]: mergeCanvasLibrary(
								Array.isArray(stored) ? stored.filter(isCanvasLibraryEntry) : [],
								entries,
								deleted
							),
							[CANVAS_LIBRARY_TOMBSTONES_KEY]: deleted
						},
						outboxKeys: keys
					};
				}
			);
			if (pid === this.pid && generation === this.generation && revision === this.revision)
				this.applySync(
					state[CANVAS_LIBRARY_STATE_KEY] as CanvasLibraryEntry[],
					state[CANVAS_LIBRARY_TOMBSTONES_KEY] as Record<string, number>
				);
		});
		this.pendingWrites = write.catch((err) => {
			console.error('[canvas library] could not save the library:', err);
		});
	}

	private notify(): void {
		const items = this.items();
		for (const listener of this.listeners) listener(items);
	}
}

export const canvasLibraryStore = new CanvasLibraryStore();
