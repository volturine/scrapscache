// What a workspace's database holds besides its notes: labels, its sync state and
// other state by key, and the one transaction that rewrites all of it.

import { copyLabel, mergeTwoLabels } from '#lib/model/index.js';
import type { Label, Note } from '#lib/types.js';
import { NOTES_STORE, resolveDbName, SYNC_STATE_STORE } from './names.js';

import {
	IMAGES_STORE,
	LABELS_STORE,
	SYNC_OUTBOX_STORE,
	enqueueDeviceWrite,
	getDB,
	outboxGenerations
} from './connection.js';
import {
	OUTBOX_GENERATION_KEY,
	abortWrite,
	nextOutboxGeneration,
	uniqueOutboxKeys,
	uploadGeneration
} from './outbox.js';
import { detachNote, imageKeysOf, imageRow, storedImageBytes, type ImageRow } from './notes.js';

function plainLabel(label: Label): Label {
	return copyLabel(label);
}

export async function getAllLabels(pid: string): Promise<Label[]> {
	const db = await getDB(pid);
	return ((await db.getAll(LABELS_STORE)) as Label[]).map(plainLabel);
}

/**
 * Save a label: the later of it and the copy stored at that moment is kept, so a
 * rename a sync saved meanwhile is never gone over by an earlier one.
 */
export async function saveLabel(
	pid: string,
	label: Label,
	syncOutboxKeys: Iterable<string> = []
): Promise<void> {
	const outboxKeys = uniqueOutboxKeys(syncOutboxKeys);
	const lean = plainLabel(label);
	const dbName = resolveDbName(pid);
	await enqueueDeviceWrite(async () => {
		const previousGeneration = outboxGenerations.get(dbName) ?? null;
		const db = await getDB(pid);
		const tx = db.transaction(
			outboxKeys.length ? [LABELS_STORE, SYNC_STATE_STORE, SYNC_OUTBOX_STORE] : [LABELS_STORE],
			'readwrite'
		);
		try {
			const labels = tx.objectStore(LABELS_STORE);
			const stored = (await labels.get(lean.id)) as Label | undefined;
			await labels.put(stored ? plainLabel(mergeTwoLabels(plainLabel(stored), lean)) : lean);
			if (outboxKeys.length) {
				const generation = await nextOutboxGeneration(tx, dbName);
				const outbox = tx.objectStore(SYNC_OUTBOX_STORE);
				for (const key of outboxKeys) await outbox.put(generation, key);
			}
			await tx.done;
		} catch (error) {
			await abortWrite(tx, dbName, previousGeneration);
			throw error;
		}
	});
}

/**
 * Delete a label and record the delete in one transaction, on top of the deletes
 * stored at that moment: one a sync saved meanwhile is kept. Returns all of them.
 */
export async function deleteLabelRecordingIt(
	pid: string,
	id: string,
	deletesKey: string,
	deletedAt: number,
	syncOutboxKeys: Iterable<string> = []
): Promise<Record<string, unknown>> {
	const outboxKeys = uniqueOutboxKeys(syncOutboxKeys);
	const dbName = resolveDbName(pid);
	return enqueueDeviceWrite(async () => {
		const previousGeneration = outboxGenerations.get(dbName) ?? null;
		const db = await getDB(pid);
		const tx = db.transaction(
			outboxKeys.length
				? [LABELS_STORE, SYNC_STATE_STORE, SYNC_OUTBOX_STORE]
				: [LABELS_STORE, SYNC_STATE_STORE],
			'readwrite'
		);
		try {
			await tx.objectStore(LABELS_STORE).delete(id);
			const syncState = tx.objectStore(SYNC_STATE_STORE);
			const stored: unknown = await syncState.get(deletesKey);
			const deletes: Record<string, unknown> =
				stored && typeof stored === 'object' && !Array.isArray(stored)
					? { ...(stored as Record<string, unknown>) }
					: {};
			deletes[id] = Math.max(Number(deletes[id]) || 0, deletedAt);
			await syncState.put(deletes, deletesKey);
			if (outboxKeys.length) {
				const generation = await nextOutboxGeneration(tx, dbName);
				const outbox = tx.objectStore(SYNC_OUTBOX_STORE);
				for (const key of outboxKeys) await outbox.put(generation, key);
			}
			await tx.done;
			return deletes;
		} catch (error) {
			await abortWrite(tx, dbName, previousGeneration);
			throw error;
		}
	});
}

export async function mergeWorkspaceState<T extends Record<string, unknown>>(
	pid: string,
	keys: readonly string[],
	merge: (current: Record<string, unknown>) => { value: T; outboxKeys?: Iterable<string> }
): Promise<T> {
	const dbName = resolveDbName(pid);
	return enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const previousGeneration = outboxGenerations.get(dbName) ?? null;
		const tx = db.transaction([SYNC_STATE_STORE, SYNC_OUTBOX_STORE], 'readwrite');
		try {
			const state = tx.objectStore(SYNC_STATE_STORE);
			const current = Object.fromEntries(
				await Promise.all(keys.map(async (key) => [key, await state.get(key)]))
			);
			const { value, outboxKeys = [] } = merge(current);
			for (const [key, item] of Object.entries(value)) await state.put(item, key);
			const dirtyKeys = uniqueOutboxKeys(outboxKeys);
			if (dirtyKeys.length) {
				const next = await nextOutboxGeneration(tx, dbName);
				for (const outboxKey of dirtyKeys)
					await tx.objectStore(SYNC_OUTBOX_STORE).put(next, outboxKey);
			}
			await tx.done;
			return value;
		} catch (error) {
			await abortWrite(tx, dbName, previousGeneration);
			throw error;
		}
	});
}

/**
 * Merge into a workspace's labels as they are stored at that moment. `merge` is
 * given the labels and the label deletes read in the transaction that writes its
 * answer, so a rename or delete another window saved meanwhile is what it sees,
 * never what it overwrites. A label it leaves out is deleted.
 */
export async function mergeStoredLabels(
	pid: string,
	tombstonesKey: string,
	merge: (stored: Label[], tombstones: unknown) => Label[]
): Promise<Label[]> {
	return enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const tx = db.transaction([LABELS_STORE, SYNC_STATE_STORE], 'readwrite');
		try {
			const labels = tx.objectStore(LABELS_STORE);
			const stored = ((await labels.getAll()) as Label[]).map(plainLabel);
			const merged = merge(stored, await tx.objectStore(SYNC_STATE_STORE).get(tombstonesKey)).map(
				plainLabel
			);
			const before = new Map(stored.map((label) => [label.id, JSON.stringify(label)]));
			for (const label of merged) {
				if (before.get(label.id) !== JSON.stringify(label)) await labels.put(label);
				before.delete(label.id);
			}
			for (const id of before.keys()) await labels.delete(id);
			await tx.done;
			return merged;
		} catch (error) {
			try {
				tx.abort();
			} catch {
				// The transaction may already have aborted after a failed request.
			}
			throw error;
		}
	});
}

/** A workspace as it is stored when `rewriteWorkspace` begins. */
export type StoredWorkspace = {
	noteIds: string[];
	labels: Label[];
	/** The workspace state asked for, by key; a key never written is undefined. */
	state: Record<string, unknown>;
	/** Moves on with every save that queues something to upload: see `uploadGeneration`. */
	uploadGeneration: number;
};

/** Everything one rewrite of a workspace writes. */
export type WorkspaceRewrite = {
	/** Drop every note, attachment and label stored before writing. */
	clear: boolean;
	notes: Note[];
	labels: Label[];
	/** Notes to delete, with their attachments. */
	dropNotes?: readonly string[];
	dropLabels?: readonly string[];
	state?: Record<string, unknown>;
	dropState?: readonly string[];
	/** Records to queue for upload, in the same transaction. */
	outboxKeys?: Iterable<string>;
};

/** What a rewrite of a workspace writes, decided when it lands, and what it reads to decide. */
export type RewritePlan = {
	/** The notes it may write, whose bytes are decoded before it lands. */
	notes: Note[];
	stateKeys: string[];
	land: (stored: StoredWorkspace) => WorkspaceRewrite;
};

/**
 * Rewrite a workspace in one transaction. Notes with their attachments, labels,
 * workspace state and the upload queue land together or not at all: a tab killed
 * part-way, or a full disk, leaves the workspace exactly as it was, and what
 * landed is already queued to upload.
 *
 * `plan` decides what to write from what is stored at that moment, so nothing
 * saved between reading and writing is missed. It must not wait for anything: a
 * transaction left idle commits. The bytes of `candidates`, the notes the plan may
 * write, are decoded before the transaction opens for the same reason.
 */
export async function rewriteWorkspace(
	pid: string,
	candidates: Note[],
	stateKeys: readonly string[],
	plan: (stored: StoredWorkspace) => WorkspaceRewrite
): Promise<void> {
	const blobs = new Map<string, ImageRow[]>();
	for (const note of candidates) {
		const rows: ImageRow[] = [];
		for (const image of note.images ?? []) {
			if (image.dataUrl) rows.push(await imageRow(note.id, image));
		}
		blobs.set(note.id, rows);
	}
	const dbName = resolveDbName(pid);
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const previousGeneration = outboxGenerations.get(dbName) ?? null;
		const tx = db.transaction(
			[NOTES_STORE, IMAGES_STORE, LABELS_STORE, SYNC_STATE_STORE, SYNC_OUTBOX_STORE],
			'readwrite'
		);
		try {
			const noteStore = tx.objectStore(NOTES_STORE);
			const imageStore = tx.objectStore(IMAGES_STORE);
			const labelStore = tx.objectStore(LABELS_STORE);
			const stateStore = tx.objectStore(SYNC_STATE_STORE);
			const [noteIds, labels, values, generation] = await Promise.all([
				noteStore.getAllKeys(),
				labelStore.getAll(),
				Promise.all(stateKeys.map((key) => stateStore.get(key))),
				stateStore.get(OUTBOX_GENERATION_KEY)
			]);
			const rewrite = plan({
				noteIds: noteIds.map(String),
				labels: (labels as Label[]).map(plainLabel),
				state: Object.fromEntries(stateKeys.map((key, index) => [key, values[index]])),
				uploadGeneration: Number(generation ?? 0)
			});
			if (rewrite.clear)
				await Promise.all([noteStore.clear(), imageStore.clear(), labelStore.clear()]);
			for (const id of rewrite.dropNotes ?? []) {
				await noteStore.delete(id);
				await imageStore.delete(imageKeysOf(id));
			}
			for (const id of rewrite.dropLabels ?? []) await labelStore.delete(id);
			for (const note of rewrite.notes) {
				for (const blob of blobs.get(note.id) ?? []) await imageStore.put(blob.value, blob.key);
				await noteStore.put(detachNote(note));
			}
			for (const label of rewrite.labels) await labelStore.put(plainLabel(label));
			for (const [key, value] of Object.entries(rewrite.state ?? {}))
				await stateStore.put(value, key);
			for (const key of rewrite.dropState ?? []) await stateStore.delete(key);
			const outboxKeys = uniqueOutboxKeys(rewrite.outboxKeys ?? []);
			if (outboxKeys.length) {
				const generation = await nextOutboxGeneration(tx, dbName);
				const outbox = tx.objectStore(SYNC_OUTBOX_STORE);
				for (const key of outboxKeys) await outbox.put(generation, key);
			}
			await tx.done;
		} catch (error) {
			await abortWrite(tx, dbName, previousGeneration);
			throw error;
		}
	});
}

// --- Link previews (device cache, shared by every workspace) ----------------

export async function getSyncState<T>(pid: string, key: string): Promise<T | undefined> {
	const db = await getDB(pid);
	return (await db.get(SYNC_STATE_STORE, key)) as T | undefined;
}

export async function setSyncState(pid: string, key: string, value: unknown): Promise<void> {
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		await db.put(SYNC_STATE_STORE, value, key);
	});
}

export async function deleteSyncState(pid: string, key: string): Promise<void> {
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		await db.delete(SYNC_STATE_STORE, key);
	});
}

const FIRED_REMINDERS_KEY = 'scrapscache-fired-reminders';

export async function getFiredReminderKeys(pid: string): Promise<string[]> {
	const stored = await getSyncState<unknown>(pid, FIRED_REMINDERS_KEY);
	return Array.isArray(stored)
		? stored.filter((item): item is string => typeof item === 'string')
		: [];
}

/**
 * Add to the fired-reminder ledger in one transaction. The service worker writes
 * the same ledger, so reading it and writing it back separately could drop a
 * reminder it claimed in between. Resolves to the keys that were not there yet.
 */
export async function addFiredReminderKeys(pid: string, keys: Iterable<string>): Promise<string[]> {
	const wanted = [...new Set(keys)];
	return enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const storeKey = FIRED_REMINDERS_KEY;
		const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
		const stored = await tx.store.get(storeKey);
		const fired = new Set(
			Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []
		);
		const added = wanted.filter((key) => !fired.has(key));
		if (added.length) await tx.store.put([...fired, ...added], storeKey);
		await tx.done;
		return added;
	});
}

export async function claimFiredReminderKey(pid: string, key: string): Promise<boolean> {
	return (await addFiredReminderKeys(pid, [key])).length > 0;
}

// --- Outbox -----------------------------------------------------------------

/**
 * Approximate size of a workspace's synced content. Attachment sizes come from
 * the `byteSize` recorded on each note's image metadata, so the blob store is
 * only read for the attachments that predate that field. Previews each device
 * renders for itself are left out, so every device shows the same figure.
 */
export async function estimateProfileBytes(pid: string): Promise<number> {
	const db = await getDB(pid);
	let bytes = 0;
	const unsized: string[] = [];
	const notes = (await db.getAll(NOTES_STORE)) as Note[];
	for (const note of notes) {
		bytes += JSON.stringify({
			...note,
			images: (note.images ?? []).map(({ thumbUrl: _preview, ...image }) => image)
		}).length;
		for (const image of note.images ?? []) {
			if (Number.isFinite(image.byteSize)) bytes += Number(image.byteSize);
			else unsized.push(`${note.id}::${image.id}`);
		}
	}
	const labels = (await db.getAll(LABELS_STORE)) as Label[];
	for (const label of labels) {
		bytes += JSON.stringify(label).length;
	}
	for (const key of unsized) {
		bytes += storedByteLength(await db.get(IMAGES_STORE, key));
	}
	return bytes;
}

function storedByteLength(value: unknown): number {
	return storedImageBytes(value)?.byteLength ?? 0;
}
