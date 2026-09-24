import { decryptSyncEnvelope } from '$lib/syncPairing';
import { attachmentToImage, isSyncRecordPayload, type SyncNote } from '$lib/syncRecords';
import { sha256 } from '$lib/syncHash';
import type { Note, NoteImage } from '$lib/types';
import type { HistoryEntry, HistoryEnvelope, HistoryPage } from '$lib/syncHistory';
import { syncStore, type SyncAccount } from '$lib/stores/sync.svelte';

export type NoteHistoryEntry = HistoryEntry & { note: SyncNote };

async function read<T>(path: string, account: SyncAccount): Promise<T> {
	const response = await syncStore.authorizedFetch(path, { cache: 'no-store' }, account);
	if (!response.ok)
		throw new Error(
			response.status === 404
				? 'This history version is no longer available.'
				: 'Could not load sync history.'
		);
	return response.json() as Promise<T>;
}

async function readOptional<T>(path: string, account: SyncAccount): Promise<T | null> {
	const response = await syncStore.authorizedFetch(path, { cache: 'no-store' }, account);
	if (response.status === 404) return null;
	if (!response.ok) throw new Error('Could not load sync history.');
	return response.json() as Promise<T>;
}

/**
 * Open a history envelope as the record this device asked for. The slot in the relay's
 * response is not trusted: binding the requested slot means an envelope moved from another
 * record fails to decrypt instead of being shown as this one.
 */
function decode(account: SyncAccount, envelope: HistoryEnvelope, slot: string) {
	if (envelope.slot !== slot) throw new Error('Could not read an encrypted history version.');
	const payload = decryptSyncEnvelope(account.syncKey, envelope.ciphertext, slot).payload;
	if (!isSyncRecordPayload(payload))
		throw new Error('Could not read an encrypted history version.');
	return payload;
}

export async function loadNoteHistory(
	account: SyncAccount,
	noteId: string,
	before?: number
): Promise<{
	entries: NoteHistoryEntry[];
	nextBefore: number | null;
}> {
	const slot = await sha256(`${account.syncKey}\u0000note:${noteId}`);
	const params = new URLSearchParams({ noteSlot: slot });
	if (before) params.set('before', String(before));
	const page = await read<HistoryPage>(
		`/api/sync/history${params.size ? `?${params}` : ''}`,
		account
	);
	const entries: NoteHistoryEntry[] = [];
	// Bound simultaneous R2 reads and decrypted payloads, including large attachments.
	for (let index = 0; index < page.entries.length; index += 5) {
		const group = await Promise.all(
			page.entries.slice(index, index + 5).map(async (entry) => {
				const envelope = await read<HistoryEnvelope>(
					`/api/sync/history?id=${entry.historyId}`,
					account
				);
				const payload = decode(account, envelope, slot);
				return payload.kind === 'note' ? { ...entry, note: payload.value } : null;
			})
		);
		for (const item of group) if (item) entries.push(item);
	}
	return { entries, nextBefore: page.nextBefore };
}

export async function hydrateHistoryNote(
	account: SyncAccount,
	entry: NoteHistoryEntry
): Promise<Note> {
	const images: NoteImage[] = [];
	for (const image of entry.note.images ?? []) {
		const slot = await sha256(`${account.syncKey}\u0000attachment:${image.id}`);
		const envelope = await readOptional<HistoryEnvelope>(
			`/api/sync/history?slot=${slot}&at=${entry.savedAt}`,
			account
		);
		const matching = (candidate: HistoryEnvelope) => {
			const payload = decode(account, candidate, slot);
			return payload.kind === 'attachment' &&
				payload.value.id === image.id &&
				payload.value.hash === image.hash
				? payload.value
				: null;
		};
		let attachment = envelope ? matching(envelope) : null;
		let before: number | undefined;
		while (!attachment) {
			const params = new URLSearchParams({ noteSlot: slot });
			if (before) params.set('before', String(before));
			const page = await read<HistoryPage>(`/api/sync/history?${params}`, account);
			for (const version of page.entries) {
				const candidate = await read<HistoryEnvelope>(
					`/api/sync/history?id=${version.historyId}`,
					account
				);
				attachment = matching(candidate);
				if (attachment) break;
			}
			if (attachment || page.nextBefore === null) break;
			before = page.nextBefore;
		}
		if (!attachment) throw new Error('An attachment from this version is no longer available.');
		images.push(attachmentToImage(attachment));
	}
	return { ...entry.note, images } as Note;
}
