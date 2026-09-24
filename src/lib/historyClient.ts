import { decryptSyncEnvelope } from '$lib/syncPairing';
import { attachmentToImage, isSyncRecordPayload, type SyncNote } from '$lib/syncRecords';
import { sha256 } from '$lib/syncHash';
import type { Note, NoteImage } from '$lib/types';
import type { HistoryEnvelope, HistoryList } from '$lib/syncHistory';
import { syncStore, type SyncAccount } from '$lib/stores/sync.svelte';

export type NoteHistoryEntry = { historyId: number; savedAt: number; note: SyncNote };

async function read<T>(path: string, account: SyncAccount): Promise<T> {
	const response = await syncStore.authorizedFetch(path, { cache: 'no-store' }, account);
	if (!response.ok) throw new Error('Could not load sync history.');
	return response.json() as Promise<T>;
}

async function readOptional<T>(path: string, account: SyncAccount): Promise<T | null> {
	const response = await syncStore.authorizedFetch(path, { cache: 'no-store' }, account);
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
		payload = decryptSyncEnvelope(account.syncKey, ciphertext, slot).payload;
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
