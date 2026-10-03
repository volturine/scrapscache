// The reusable Excalidraw shape library. Each workspace has its own, and each
// item syncs as its own record: the newest version of an item wins, and a
// delete wins over every version it saw.
import { stableStringify } from '#lib/model/stableStringify.js';
import { getSyncState } from '#lib/db/idb.js';

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

function sanitizeTombstones(value: unknown): Record<string, number> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).flatMap(([id, at]) => (Number(at) > 0 ? [[id, Number(at)]] : []))
	);
}

/** A workspace's library as this device saved it, whether or not it is the open one. */
export async function readCanvasLibrary(
	pid: string
): Promise<{ entries: CanvasLibraryEntry[]; tombstones: Record<string, number> }> {
	const [entries, stored] = await Promise.all([
		getSyncState<unknown>(pid, CANVAS_LIBRARY_STATE_KEY),
		getSyncState<unknown>(pid, CANVAS_LIBRARY_TOMBSTONES_KEY)
	]);
	const tombstones = sanitizeTombstones(stored);
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
