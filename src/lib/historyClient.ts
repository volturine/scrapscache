import { decryptSyncEnvelope } from '$lib/syncPairing';
import { attachmentToImage, isSyncRecordPayload, type SyncNote } from '$lib/syncRecords';
import { sha256 } from '$lib/syncHash';
import type { Note, NoteImage } from '$lib/types';
import type { HistoryEntry, HistoryEnvelope, HistoryPage } from '$lib/syncHistory';
import type { ProfileHistoryPage, ProfileSnapshotPage } from '$lib/syncHistory';
import type { SyncSnapshot } from '$lib/stores/sync.svelte';
import type { SyncRecordPayload } from '$lib/syncRecords';
import { syncStore, type SyncAccount } from '$lib/stores/sync.svelte';

export type NoteHistoryEntry = HistoryEntry & { note: SyncNote };
export type HistoricalProfile = { accountId: string; at: number; snapshot: SyncSnapshot };

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

function decode(account: SyncAccount, envelope: HistoryEnvelope) {
	const payload = decryptSyncEnvelope(account.syncKey, envelope.ciphertext, envelope.slot).payload;
	if (!isSyncRecordPayload(payload))
		throw new Error('Could not read an encrypted history version.');
	return payload;
}

export async function loadProfilePoints(
	account: SyncAccount,
	before?: number
): Promise<ProfileHistoryPage> {
	return read<ProfileHistoryPage>(
		`/api/sync/history?points=1${before ? `&before=${before}` : ''}`,
		account
	);
}

export async function loadHistoricalProfile(
	account: SyncAccount,
	at: number
): Promise<HistoricalProfile> {
	const records: SyncRecordPayload[] = [];
	let after: string | null = '';
	while (after !== null) {
		const page: ProfileSnapshotPage = await read<ProfileSnapshotPage>(
			`/api/sync/history?profile=${at}${after ? `&after=${after}` : ''}`,
			account
		);
		for (const envelope of page.envelopes) records.push(decode(account, envelope));
		after = page.nextAfter;
	}
	const attachments = new Map<string, ReturnType<typeof attachmentToImage>>();
	const snapshot: SyncSnapshot = {
		notes: [],
		labels: [],
		boards: [],
		tombstones: {},
		labelTombstones: {},
		boardTombstones: {}
	};
	for (const record of records) {
		switch (record.kind) {
			case 'attachment':
				attachments.set(record.value.id, attachmentToImage(record.value));
				break;
			case 'label':
				snapshot.labels.push(record.value);
				break;
			case 'board':
				snapshot.boards.push(record.value);
				break;
			case 'note-tombstone':
				snapshot.tombstones[record.id] = record.deletedAt;
				break;
			case 'label-tombstone':
				snapshot.labelTombstones[record.id] = record.deletedAt;
				break;
			case 'board-tombstone':
				snapshot.boardTombstones[record.id] = record.deletedAt;
				break;
		}
	}
	for (const record of records)
		if (record.kind === 'note') {
			const images = (record.value.images ?? []).map((ref) => {
				const image = attachments.get(ref.id);
				if (!image || image.contentHash !== ref.hash)
					throw new Error('An attachment from this history point is unavailable.');
				return image;
			});
			snapshot.notes.push({ ...record.value, images } as Note);
		}
	return { accountId: account.accountId, at, snapshot };
}

export async function loadNoteHistory(
	account: SyncAccount,
	before?: number,
	noteId?: string
): Promise<{
	entries: NoteHistoryEntry[];
	nextBefore: number | null;
}> {
	const slot = noteId ? await sha256(`${account.syncKey}\u0000note:${noteId}`) : null;
	const params = new URLSearchParams();
	if (before) params.set('before', String(before));
	if (slot) params.set('noteSlot', slot);
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
				const payload = decode(account, envelope);
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
		const envelope = await read<HistoryEnvelope>(
			`/api/sync/history?slot=${slot}&at=${entry.savedAt}`,
			account
		);
		const payload = decode(account, envelope);
		if (
			payload.kind !== 'attachment' ||
			payload.value.id !== image.id ||
			payload.value.hash !== image.hash
		) {
			throw new Error('An attachment from this version is no longer available.');
		}
		images.push(attachmentToImage(payload.value));
	}
	return { ...entry.note, images } as Note;
}
