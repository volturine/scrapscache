import { decryptSyncPayload } from '#lib/syncPairing.js';
import {
	attachmentToImage,
	isSyncRecordPayload,
	type SyncAttachment,
	type SyncNote
} from '#lib/syncRecords.js';
import { sha256 } from '#lib/syncHash.js';
import type { Note, NoteImage } from '#lib/types.js';
import type { HistoryEnvelope, HistoryList } from '#lib/syncHistory.js';
import { syncStore, type SyncAccount } from '#lib/stores/sync.svelte.js';

export type NoteHistoryEntry = { historyId: number; savedAt: number; note: SyncNote };

async function read<T>(path: string, account: SyncAccount): Promise<T> {
	const response = await syncStore.authorizedFetch(path, { cache: 'no-store' }, account);
	if (!response.ok) throw new Error('Could not load sync history.');
	return response.json() as Promise<T>;
}

async function readOptional<T>(
	path: string,
	account: SyncAccount,
	signal?: AbortSignal
): Promise<T | null> {
	const response = await syncStore.authorizedFetch(path, { cache: 'no-store', signal }, account);
	if (response.status === 404) return null;
	if (!response.ok) throw new Error('Could not load sync history.');
	return response.json() as Promise<T>;
}

/**
 * Open a history envelope as the record this device asked for. The relay's own labels are
 * not trusted: binding the requested slot means an envelope moved from another record fails
 * to decrypt instead of being shown as this one.
 */
function decode(account: SyncAccount, ciphertext: string, slot: string) {
	let payload: unknown;
	try {
		payload = decryptSyncPayload(account.syncKey, ciphertext, slot);
	} catch {
		payload = null;
	}
	if (!isSyncRecordPayload(payload))
		throw new Error('Could not read an encrypted history version.');
	return payload;
}

function listVersions(account: SyncAccount, slot: string): Promise<HistoryList> {
	return read<HistoryList>(`/api/sync/history?slot=${slot}`, account);
}

/** A note's retained versions, newest first, in one request. */
export async function loadNoteHistory(
	account: SyncAccount,
	noteId: string
): Promise<NoteHistoryEntry[]> {
	const slot = await sha256(`${account.syncKey}\u0000note:${noteId}`);
	const { versions } = await listVersions(account, slot);
	return versions.flatMap(({ historyId, savedAt, ciphertext }) => {
		const payload = decode(account, ciphertext, slot);
		return payload.kind === 'note' ? [{ historyId, savedAt, note: payload.value }] : [];
	});
}

/** How long one attachment may take to arrive when asked for by name. */
const CURRENT_ATTACHMENT_TIMEOUT_MS = 60_000;

/**
 * The attachment record the relay holds now under this id, whatever its version;
 * null when it holds none. A sync only downloads what changed since the last one,
 * so this is how a device gets bytes it should already hold.
 */
export async function loadCurrentAttachment(
	account: SyncAccount,
	id: string
): Promise<SyncAttachment | null> {
	const slot = await sha256(`${account.syncKey}\u0000attachment:${id}`);
	// No version is saved that far ahead, so the relay answers with the live record.
	// A sync waits on this, so a request that stalls gives up and the sync fails.
	const envelope = await readOptional<HistoryEnvelope>(
		`/api/sync/history?slot=${slot}&at=${Number.MAX_SAFE_INTEGER}`,
		account,
		AbortSignal.timeout(CURRENT_ATTACHMENT_TIMEOUT_MS)
	);
	if (!envelope) return null;
	const payload = decode(account, envelope.ciphertext, slot);
	if (payload.kind !== 'attachment' || payload.value.id !== id)
		throw new Error('Could not read an encrypted attachment.');
	return payload.value;
}

/**
 * A version with the attachments the relay still holds. An attachment deleted since (removed
 * from the note, or the note deleted) is gone for good, so it is counted rather than fatal.
 */
export async function hydrateHistoryNote(
	account: SyncAccount,
	entry: NoteHistoryEntry
): Promise<{ note: Note; missingAttachments: number }> {
	const images: NoteImage[] = [];
	let missingAttachments = 0;
	for (const image of entry.note.images ?? []) {
		const slot = await sha256(`${account.syncKey}\u0000attachment:${image.id}`);
		const matching = (ciphertext: string) => {
			const payload = decode(account, ciphertext, slot);
			return payload.kind === 'attachment' &&
				payload.value.id === image.id &&
				payload.value.hash === image.hash
				? payload.value
				: null;
		};
		const envelope = await readOptional<HistoryEnvelope>(
			`/api/sync/history?slot=${slot}&at=${entry.savedAt}`,
			account
		);
		let attachment = envelope ? matching(envelope.ciphertext) : null;
		// Upload times can differ from the note's; the attachment's own versions still hold it.
		if (!attachment) {
			for (const version of (await listVersions(account, slot)).versions) {
				attachment = matching(version.ciphertext);
				if (attachment) break;
			}
		}
		if (attachment) images.push(attachmentToImage(attachment));
		else missingAttachments += 1;
	}
	return { note: { ...entry.note, images } as Note, missingAttachments };
}
