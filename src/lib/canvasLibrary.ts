// The reusable Excalidraw shape library. Each workspace has its own, and each
// item syncs as its own record: the newest version of an item wins, and a
// delete wins over every version it saw.
import { stableStringify } from '#lib/model/stableStringify.js';
import { getSyncState, mergeWorkspaceState } from '#lib/db/idb.js';

export const CANVAS_LIBRARY_STATE_KEY = 'scrapscache-canvas-library';
export const CANVAS_LIBRARY_TOMBSTONES_KEY = 'scrapscache-canvas-library-tombstones';

/** An Excalidraw library item, kept as Excalidraw wrote it. */
export type CanvasLibraryItem = {
	id: string;
	created: number;
	elements: unknown[];
	[field: string]: unknown;
};

export type CanvasLibraryEntry = {
	id: string;
	updatedAt: number;
	item: CanvasLibraryItem;
};

export type CanvasLibraryChange = {
	upserts: CanvasLibraryItem[];
	removals: string[];
};

export function isCanvasLibraryItem(value: unknown): value is CanvasLibraryItem {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const item = value as Partial<CanvasLibraryItem>;
	return (
		typeof item.id === 'string' &&
		item.id.length > 0 &&
		typeof item.created === 'number' &&
		Number.isFinite(item.created) &&
		Array.isArray(item.elements)
	);
}

export function isCanvasLibraryEntry(value: unknown): value is CanvasLibraryEntry {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const entry = value as Partial<CanvasLibraryEntry>;
	return (
		typeof entry.id === 'string' &&
		typeof entry.updatedAt === 'number' &&
		Number.isFinite(entry.updatedAt) &&
		isCanvasLibraryItem(entry.item) &&
		entry.item.id === entry.id
	);
}

function alive(entry: CanvasLibraryEntry, tombstones: Record<string, number>): boolean {
	return entry.updatedAt > (Number(tombstones[entry.id]) || 0);
}

/** Same-time versions compare by content, so every device keeps the same one. */
function newer(left: CanvasLibraryEntry, right: CanvasLibraryEntry): CanvasLibraryEntry {
	if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? left : right;
	return stableStringify(left.item) >= stableStringify(right.item) ? left : right;
}

export function mergeCanvasLibrary(
	local: Iterable<CanvasLibraryEntry>,
	remote: Iterable<CanvasLibraryEntry>,
	tombstones: Record<string, number>
): CanvasLibraryEntry[] {
	const byId = new Map<string, CanvasLibraryEntry>();
	for (const entry of [...local, ...remote]) {
		if (!isCanvasLibraryEntry(entry)) continue;
		const current = byId.get(entry.id);
		byId.set(entry.id, current ? newer(current, entry) : entry);
	}
	return [...byId.values()].filter((entry) => alive(entry, tombstones));
}

/** Newest first, as Excalidraw lists items it adds. */
export function libraryItemsFor(entries: Iterable<CanvasLibraryEntry>): CanvasLibraryItem[] {
	return [...entries]
		.map((entry) => entry.item)
		.sort((left, right) => right.created - left.created || left.id.localeCompare(right.id));
}

export function sanitizeLibraryTombstones(value: unknown): Record<string, number> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).flatMap(([id, at]) => (Number(at) > 0 ? [[id, Number(at)]] : []))
	);
}

/**
 * A backup's library brought into a workspace's, as a new save of each item so it
 * wins over any older version or delete elsewhere. Adding keeps what is there and
 * brings what is missing; `replace` also deletes what the backup does not have.
 * `keys` are the records that changed and have to be uploaded.
 */
export function restoredCanvasLibrary(
	stored: { entries: Iterable<CanvasLibraryEntry>; tombstones: Record<string, number> },
	items: readonly unknown[],
	replace: boolean,
	now: number
): { entries: CanvasLibraryEntry[]; tombstones: Record<string, number>; keys: string[] } {
	const byId = new Map([...stored.entries].map((entry) => [entry.id, entry]));
	const tombstones = { ...stored.tombstones };
	const keys: string[] = [];
	const restored = new Set<string>();
	for (const item of items.filter(isCanvasLibraryItem)) {
		restored.add(item.id);
		const current = byId.get(item.id);
		if (current && !replace) continue;
		const updatedAt = Math.max(now, (current?.updatedAt ?? 0) + 1, (tombstones[item.id] ?? 0) + 1);
		byId.set(item.id, {
			id: item.id,
			updatedAt,
			item: JSON.parse(JSON.stringify(item)) as CanvasLibraryItem
		});
		keys.push(`library-item:${item.id}`);
	}
	if (replace) {
		for (const [id, entry] of byId) {
			if (restored.has(id)) continue;
			tombstones[id] = Math.max(now, entry.updatedAt + 1);
			byId.delete(id);
			keys.push(`library-item-tombstone:${id}`);
		}
	}
	return { entries: [...byId.values()], tombstones, keys };
}

/**
 * Merge entries and deletes into the library a workspace has saved, in one
 * transaction, and return what is saved after. `replace` starts from nothing
 * instead of from what is saved.
 */
export async function mergeStoredCanvasLibrary(
	pid: string,
	entries: CanvasLibraryEntry[],
	tombstones: Record<string, number>,
	options: { replace?: boolean; outboxKeys?: Iterable<string> } = {}
): Promise<{ entries: CanvasLibraryEntry[]; tombstones: Record<string, number> }> {
	const state = await mergeWorkspaceState(
		pid,
		[CANVAS_LIBRARY_STATE_KEY, CANVAS_LIBRARY_TOMBSTONES_KEY],
		(current) => {
			const deleted = sanitizeLibraryTombstones(
				options.replace ? {} : current[CANVAS_LIBRARY_TOMBSTONES_KEY]
			);
			for (const [id, at] of Object.entries(sanitizeLibraryTombstones(tombstones)))
				deleted[id] = Math.max(deleted[id] ?? 0, at);
			const stored = options.replace ? [] : current[CANVAS_LIBRARY_STATE_KEY];
			return {
				value: {
					[CANVAS_LIBRARY_STATE_KEY]: mergeCanvasLibrary(
						Array.isArray(stored) ? stored.filter(isCanvasLibraryEntry) : [],
						entries,
						deleted
					),
					[CANVAS_LIBRARY_TOMBSTONES_KEY]: deleted
				},
				outboxKeys: options.outboxKeys ?? []
			};
		}
	);
	return {
		entries: state[CANVAS_LIBRARY_STATE_KEY] as CanvasLibraryEntry[],
		tombstones: state[CANVAS_LIBRARY_TOMBSTONES_KEY] as Record<string, number>
	};
}

/** A workspace's library as this device saved it, whether or not it is the open one. */
export async function readCanvasLibrary(
	pid: string
): Promise<{ entries: CanvasLibraryEntry[]; tombstones: Record<string, number> }> {
	const [entries, stored] = await Promise.all([
		getSyncState<unknown>(pid, CANVAS_LIBRARY_STATE_KEY),
		getSyncState<unknown>(pid, CANVAS_LIBRARY_TOMBSTONES_KEY)
	]);
	const tombstones = sanitizeLibraryTombstones(stored);
	return {
		entries: mergeCanvasLibrary([], Array.isArray(entries) ? entries : [], tombstones),
		tombstones
	};
}

/** What the editor changed between two lists it reported. */
export function diffCanvasLibrary(
	previous: readonly unknown[],
	next: readonly unknown[]
): CanvasLibraryChange {
	const before = new Map(
		previous.filter(isCanvasLibraryItem).map((item) => [item.id, stableStringify(item)])
	);
	const after = new Map(next.filter(isCanvasLibraryItem).map((item) => [item.id, item]));
	const upserts = [...after.values()].filter(
		(item) => before.get(item.id) !== stableStringify(item)
	);
	const removals = [...before.keys()].filter((id) => !after.has(id));
	return { upserts, removals };
}
