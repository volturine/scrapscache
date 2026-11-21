// Incremental sync decisions. Upload only dirty records; never infer "unused"
// attachments from a page that has not yet applied their parent notes.
import type { Note } from '#lib/types.js';
import { isTombstoned } from '#lib/model/index.js';
import type { SyncNote, SyncRecord, SyncSnapshot } from '#lib/syncRecords.js';
import { sha256 } from '#lib/syncHash.js';

/**
 * What the relay holds of attachments, as this device has seen it: every attachment
 * record it downloaded or uploaded, and the attachments each note record lists.
 */
export type RelayAttachments = {
	/** The version (content hash) of each attachment record, by attachment id. */
	versions: Record<string, string>;
	/** The attachment ids the relay's copy of each note lists, by note id. */
	listed: Record<string, string[]>;
};

export function emptyRelayAttachments(): RelayAttachments {
	return { versions: {}, listed: {} };
}

/**
 * The attachment versions the relay is known to hold, by attachment id. A record no
 * note on the relay lists does not count: any device may delete it, and a delete
 * leaves nothing behind for this device to download.
 */
export function relayHeldVersions(relay: RelayAttachments): Map<string, string> {
	const held = new Map<string, string>();
	for (const ids of Object.values(relay.listed)) {
		for (const id of ids) {
			const version = relay.versions[id];
			if (version !== undefined) held.set(id, version);
		}
	}
	return held;
}

/**
 * A note record as the relay may hold it: it lists only the attachment versions the
 * relay holds once the request commits, so the relay never lists bytes it lacks.
 * The others join in the request that carries their bytes.
 */
export async function noteRecordForRelay(
	record: SyncRecord,
	held: ReadonlyMap<string, string>
): Promise<SyncRecord> {
	if (record.payload.kind !== 'note') return record;
	const note: SyncNote = record.payload.value;
	const images = (note.images ?? []).filter((image) => held.get(image.id) === image.hash);
	if (images.length === (note.images ?? []).length) return record;
	const { images: _all, ...rest } = note;
	const payload = {
		kind: 'note' as const,
		value: { ...rest, ...(images.length ? { images } : {}) }
	};
	return { key: record.key, payload, fingerprint: await sha256(payload) };
}

/** The records a note is uploaded as: itself, and each attachment it lists. */
export function noteRecordKeys(note: Note): string[] {
	return [`note:${note.id}`, ...(note.images ?? []).map((image) => `attachment:${image.id}`)];
}

export function currentRecordKeys(snapshot: SyncSnapshot): Set<string> {
	const keys = new Set<string>();
	for (const note of snapshot.notes) {
		if (isTombstoned(note.id, snapshot.tombstones)) continue;
		keys.add(`note:${note.id}`);
		for (const image of note.images ?? []) keys.add(`attachment:${image.id}`);
	}
	for (const label of snapshot.labels) {
		if (!isTombstoned(label.id, snapshot.labelTombstones)) keys.add(`label:${label.id}`);
	}
	for (const board of snapshot.boards) {
		if (!isTombstoned(board.id, snapshot.boardTombstones)) keys.add(`board:${board.id}`);
	}
	for (const entry of snapshot.libraryItems) {
		if (entry.updatedAt > (Number(snapshot.libraryTombstones[entry.id]) || 0))
			keys.add(`library-item:${entry.id}`);
	}
	for (const id of Object.keys(snapshot.tombstones)) keys.add(`note-tombstone:${id}`);
	for (const id of Object.keys(snapshot.labelTombstones)) keys.add(`label-tombstone:${id}`);
	for (const id of Object.keys(snapshot.boardTombstones)) keys.add(`board-tombstone:${id}`);
	for (const id of Object.keys(snapshot.libraryTombstones))
		keys.add(`library-item-tombstone:${id}`);
	return keys;
}

/**
 * Slot deletes are incremental GC, not catch-up. Attachments are only removed
 * after this device has finished downloading (`catchUpComplete`) and no live
 * applied note still lists them. A deleted note takes its reminder history
 * with it. Tombstone slots stay on the relay.
 */
export function planDeletableKeys(input: {
	recordIds: Record<string, string>;
	snapshot: SyncSnapshot;
	pullOnly: boolean;
	catchUpComplete: boolean;
}): string[] {
	if (input.pullOnly) return [];
	const { snapshot } = input;
	const current = currentRecordKeys(snapshot);
	const deletable: string[] = [];
	for (const key of Object.keys(input.recordIds)) {
		if (current.has(key)) continue;
		if (key.startsWith('note:')) {
			if (isTombstoned(key.slice('note:'.length), snapshot.tombstones)) deletable.push(key);
			continue;
		}
		if (key.startsWith('label:')) {
			if (isTombstoned(key.slice('label:'.length), snapshot.labelTombstones)) deletable.push(key);
			continue;
		}
		if (key.startsWith('board:')) {
			if (isTombstoned(key.slice('board:'.length), snapshot.boardTombstones)) deletable.push(key);
			continue;
		}
		if (key.startsWith('library-item:')) {
			if (isTombstoned(key.slice('library-item:'.length), snapshot.libraryTombstones))
				deletable.push(key);
			continue;
		}
		if (key.startsWith('attachment:')) {
			if (!input.catchUpComplete) continue;
			// A replacement note can land before its new photo. Keep the old slot
			// until every photo this device still lists is on the relay.
			const waitingForUpload = [...current].some(
				(item) => item.startsWith('attachment:') && !input.recordIds[item]
			);
			if (waitingForUpload) continue;
			deletable.push(key);
		}
	}
	return deletable.slice(0, 500);
}

/** A drained pull may reveal orphaned slots, which require one more relay round to delete. */
export function syncRoundHasMore(options: {
	remoteHasMore: boolean;
	remainingUploads: boolean;
	pendingDeletes: boolean;
}): boolean {
	return options.remoteHasMore || options.remainingUploads || options.pendingDeletes;
}

export function reconcileBaseline(input: {
	previous: Record<string, string>;
	uploaded: Record<string, string>;
	remote: Record<string, string>;
	merged: Record<string, string>;
	currentKeys: Set<string>;
	referencedAttachments: Set<string>;
	/** Every remote change has been downloaded, so an attachment no note shows is an orphan. */
	catchUpComplete: boolean;
}): { baseline: Record<string, string>; dirtyKeys: string[]; ackKeys: string[] } {
	const baseline = { ...input.previous };
	const dirtyKeys: string[] = [];
	const ackKeys: string[] = [];

	for (const [key, fingerprint] of Object.entries(input.uploaded)) {
		baseline[key] = fingerprint;
		if (!input.merged[key] || input.merged[key] === fingerprint) ackKeys.push(key);
		else dirtyKeys.push(key);
	}

	for (const [key, remoteFingerprint] of Object.entries(input.remote)) {
		const mergedFingerprint = input.merged[key];
		if (mergedFingerprint && mergedFingerprint !== remoteFingerprint) {
			baseline[key] = remoteFingerprint;
			dirtyKeys.push(key);
			continue;
		}
		if (mergedFingerprint) {
			baseline[key] = mergedFingerprint;
			ackKeys.push(key);
			continue;
		}
		// An attachment can download before the note that shows it. Until catch-up ends
		// it is the cloud's copy; forgetting that re-uploaded it unchanged.
		if (key.startsWith('attachment:') && !input.catchUpComplete) baseline[key] = remoteFingerprint;
		else delete baseline[key];
		ackKeys.push(key);
	}

	for (const [key, fingerprint] of Object.entries(input.previous)) {
		if (!key.startsWith('attachment:')) continue;
		const attachmentId = key.slice('attachment:'.length);
		if (input.referencedAttachments.has(attachmentId) && !(key in baseline)) {
			baseline[key] = fingerprint;
		}
	}

	for (const key of Object.keys(baseline)) {
		if (key.startsWith('attachment:')) {
			const attachmentId = key.slice('attachment:'.length);
			if (input.catchUpComplete && !input.referencedAttachments.has(attachmentId))
				delete baseline[key];
			continue;
		}
		if (!input.currentKeys.has(key) && !(key in input.uploaded)) delete baseline[key];
	}

	return { baseline, dirtyKeys: [...new Set(dirtyKeys)], ackKeys: [...new Set(ackKeys)] };
}

export function referencedAttachmentIds(
	notes: Note[],
	tombstones: Record<string, number>
): Set<string> {
	const ids = new Set<string>();
	for (const note of notes) {
		if (isTombstoned(note.id, tombstones)) continue;
		for (const image of note.images ?? []) ids.add(image.id);
	}
	return ids;
}

export function fingerprintMapFrom(records: SyncRecord[]): Record<string, string> {
	return Object.fromEntries(records.map((record) => [record.key, record.fingerprint]));
}

export function syncControlKeys(accountId: string): {
	cursor: string;
	baseline: string;
	recordIds: string;
	relayAttachments: string;
} {
	return {
		cursor: `scrapscache-sync-cursor:${accountId}`,
		baseline: `scrapscache-sync-record-fingerprints:${accountId}`,
		recordIds: `scrapscache-sync-record-ids:${accountId}`,
		relayAttachments: `scrapscache-sync-relay-attachments:${accountId}`
	};
}
