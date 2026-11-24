// The upload queue of a workspace: which records it owes the relay, and since when.

import { type IDBPTransaction } from 'idb';
import { resolveDbName, SYNC_STATE_STORE } from './names.js';

import { SYNC_OUTBOX_STORE, enqueueDeviceWrite, getDB, outboxGenerations } from './connection.js';

export const OUTBOX_GENERATION_KEY = 'scrapscache-outbox-generation';

export function abortWrite(
	tx:
		| IDBPTransaction<unknown, string[], 'readwrite'>
		| IDBPTransaction<unknown, string[], 'readonly'>,
	dbName: string,
	previousGeneration: number | null
): Promise<void> {
	try {
		tx.abort();
	} catch {
		// The transaction may already have aborted after a failed request.
	}
	if (previousGeneration != null) {
		outboxGenerations.set(dbName, previousGeneration);
	} else {
		outboxGenerations.delete(dbName);
	}
	return tx.done.catch(() => undefined);
}

export async function nextOutboxGeneration(
	tx: IDBPTransaction<unknown, string[], 'readwrite'>,
	dbName: string
): Promise<number> {
	// Read where it is written: another window may have moved it on since this one
	// last looked, and it must never repeat or go back, whatever the clock does.
	const stored = Number((await tx.objectStore(SYNC_STATE_STORE).get(OUTBOX_GENERATION_KEY)) ?? 0);
	const generation = Math.max(Date.now(), stored + 1, (outboxGenerations.get(dbName) ?? 0) + 1);
	outboxGenerations.set(dbName, generation);
	await tx.objectStore(SYNC_STATE_STORE).put(generation, OUTBOX_GENERATION_KEY);
	return generation;
}

/**
 * A number that moves on with every save, from any window, that queues something of
 * this workspace to upload: every edit does. Read from the database, so two reads
 * that agree had no such save between them.
 */
export async function uploadGeneration(pid: string): Promise<number> {
	const db = await getDB(pid);
	return Number((await db.get(SYNC_STATE_STORE, OUTBOX_GENERATION_KEY)) ?? 0);
}

/**
 * How far the upload queue has come, read from the database: another window may
 * have queued something since this one last looked, and a sync has to be able to
 * settle that too.
 */
export function getOutboxGeneration(pid: string): Promise<number> {
	const dbName = resolveDbName(pid);
	return enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const stored = Number((await db.get(SYNC_STATE_STORE, OUTBOX_GENERATION_KEY)) ?? 0);
		const generation = Math.max(stored, outboxGenerations.get(dbName) ?? 0);
		outboxGenerations.set(dbName, generation);
		return generation;
	});
}

export function uniqueOutboxKeys(keys: Iterable<string>): string[] {
	return [...new Set(keys)];
}

/**
 * Both arguments are named. A single key is a string and so is a workspace, so
 * a signature that took either could mark a signed-in workspace's uploads
 * against the anonymous one, and those changes would never leave the device.
 */
export async function markSyncOutbox(pid: string, keys: Iterable<string>): Promise<number> {
	const unique = uniqueOutboxKeys(keys);
	if (unique.length === 0) return 0;
	const dbName = resolveDbName(pid);
	return enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const previousGeneration = outboxGenerations.get(dbName) ?? null;
		const tx = db.transaction([SYNC_STATE_STORE, SYNC_OUTBOX_STORE], 'readwrite');
		try {
			const generation = await nextOutboxGeneration(tx, dbName);
			const outbox = tx.objectStore(SYNC_OUTBOX_STORE);
			for (const key of unique) await outbox.put(generation, key);
			await tx.done;
			return generation;
		} catch (error) {
			await abortWrite(tx, dbName, previousGeneration);
			throw error;
		}
	});
}

export async function getSyncOutboxKeys(pid: string): Promise<string[]> {
	const db = await getDB(pid);
	const keys = await db.getAllKeys(SYNC_OUTBOX_STORE);
	return keys.map(String);
}

export async function clearSyncOutbox(
	pid: string,
	keys: Iterable<string>,
	through: number = Number.POSITIVE_INFINITY
): Promise<void> {
	const unique = uniqueOutboxKeys(keys);
	if (unique.length === 0) return;
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const tx = db.transaction(SYNC_OUTBOX_STORE, 'readwrite');
		for (const key of unique) {
			const markedAt = Number(await tx.store.get(key));
			if (markedAt > 0 && markedAt <= through) await tx.store.delete(key);
		}
		await tx.done;
	});
}

export async function commitSyncControl(
	pid: string,
	state: Iterable<readonly [key: string, value: unknown]>,
	acknowledgements: Iterable<{ keys: Iterable<string>; through: number }> = []
): Promise<void> {
	const entries = [...state];
	const acknowledged = [...acknowledgements].map(({ keys, through }) => ({
		keys: uniqueOutboxKeys(keys),
		through
	}));
	await enqueueDeviceWrite(async () => {
		const db = await getDB(pid);
		const tx = db.transaction([SYNC_STATE_STORE, SYNC_OUTBOX_STORE], 'readwrite');
		try {
			const syncState = tx.objectStore(SYNC_STATE_STORE);
			const outbox = tx.objectStore(SYNC_OUTBOX_STORE);
			for (const [key, value] of entries) await syncState.put(value, key);
			for (const { keys, through } of acknowledged) {
				for (const key of keys) {
					const markedAt = Number(await outbox.get(key));
					if (markedAt > 0 && markedAt <= through) await outbox.delete(key);
				}
			}
			await tx.done;
		} catch (error) {
			try {
				tx.abort();
			} catch {
				// aborted
			}
			await tx.done.catch(() => undefined);
			throw error;
		}
	});
}

// --- Profiles ---------------------------------------------------------------
