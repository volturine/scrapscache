import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncIdentity, encryptSyncPayload } from '$lib/syncPairing';
import { sha256 } from '$lib/syncHash';
import { syncStore } from '$lib/stores/sync.svelte';
import { hydrateHistoryNote, loadNoteHistory } from './historyClient';

afterEach(() => vi.restoreAllMocks());

describe('encrypted note history', () => {
	it('decrypts note versions and retrieves their matching attachment at that time', async () => {
		const account = createSyncIdentity();
		const savedAt = Date.now();
		const noteSlot = await sha256(`${account.syncKey}\u0000note:old-note`);
		const imageSlot = await sha256(`${account.syncKey}\u0000attachment:old-image`);
		const attachment = {
			id: 'old-image',
			mime: 'image/png',
			createdAt: 1,
			hash: await sha256('data:image/png;base64,QQ=='),
			dataUrl: 'data:image/png;base64,QQ=='
		};
		const note = {
			id: 'old-note',
			title: 'Earlier title',
			body: 'Earlier body',
			color: 'default',
			pinned: false,
			archived: false,
			trashed: false,
			createdAt: 1,
			updatedAt: 1,
			labels: [],
			images: [{ id: attachment.id, mime: attachment.mime, createdAt: 1, hash: attachment.hash }]
		};
		const noteEnvelope = {
			id: 'old-version',
			slot: noteSlot,
			ciphertext: encryptSyncPayload(account.syncKey, { kind: 'note', value: note }, noteSlot)
		};
		const imageEnvelope = {
			id: 'old-attachment',
			slot: imageSlot,
			ciphertext: encryptSyncPayload(
				account.syncKey,
				{ kind: 'attachment', value: attachment },
				imageSlot
			)
		};
		const fetch = vi.spyOn(syncStore, 'authorizedFetch').mockImplementation(async (path) => {
			const url = String(path);
			const body = url.includes('?id=')
				? noteEnvelope
				: url.includes('?slot=')
					? imageEnvelope
					: {
							entries: [{ historyId: 1, savedAt }],
							nextBefore: null
						};
			return new Response(JSON.stringify(body), {
				headers: { 'content-type': 'application/json' }
			});
		});
		const page = await loadNoteHistory(account, note.id);
		expect(page.entries.map((entry) => entry.note.title)).toEqual(['Earlier title']);
		expect(fetch).toHaveBeenCalledWith(
			`/api/sync/history?noteSlot=${noteSlot}`,
			{ cache: 'no-store' },
			account
		);
		const restored = await hydrateHistoryNote(account, page.entries[0]);
		expect(restored.images?.[0].dataUrl).toBe(attachment.dataUrl);
		expect(fetch).toHaveBeenCalledWith(
			`/api/sync/history?slot=${imageSlot}&at=${savedAt}`,
			{ cache: 'no-store' },
			account
		);
	});

	it('finds the attachment by encrypted history when the timestamp lookup returns a newer version', async () => {
		const account = createSyncIdentity();
		const imageSlot = await sha256(`${account.syncKey}\u0000attachment:image`);
		const oldImage = {
			id: 'image',
			mime: 'image/png',
			createdAt: 1,
			hash: await sha256('data:image/png;base64,QQ=='),
			dataUrl: 'data:image/png;base64,QQ=='
		};
		const newImage = {
			...oldImage,
			hash: await sha256('data:image/png;base64,Qg=='),
			dataUrl: 'data:image/png;base64,Qg=='
		};
		const envelope = (id: string, value: typeof oldImage) => ({
			id,
			slot: imageSlot,
			ciphertext: encryptSyncPayload(account.syncKey, { kind: 'attachment', value }, imageSlot)
		});
		const oldEnvelope = envelope('old', oldImage);
		const newEnvelope = envelope('new', newImage);
		const fetch = vi.spyOn(syncStore, 'authorizedFetch').mockImplementation(async (path) => {
			const url = String(path);
			const body = url.includes('?slot=')
				? newEnvelope
				: url.includes('?noteSlot=')
					? {
							entries: [
								{ historyId: 2, savedAt: 2 },
								{ historyId: 1, savedAt: 1 }
							],
							nextBefore: null
						}
					: url.includes('?id=2')
						? newEnvelope
						: oldEnvelope;
			return new Response(JSON.stringify(body), {
				headers: { 'content-type': 'application/json' }
			});
		});
		const restored = await hydrateHistoryNote(account, {
			historyId: 1,
			savedAt: 1,
			note: {
				id: 'note',
				title: '',
				body: '',
				color: 'default',
				pinned: false,
				archived: false,
				trashed: false,
				trashedAt: null,
				createdAt: 1,
				updatedAt: 1,
				reminder: null,
				labels: [],
				images: [{ id: 'image', mime: 'image/png', createdAt: 1, hash: oldImage.hash }]
			}
		});
		expect(restored.images?.[0].dataUrl).toBe(oldImage.dataUrl);
		expect(fetch.mock.calls.some(([path]) => String(path).includes(`?noteSlot=${imageSlot}`))).toBe(
			true
		);
		expect(fetch.mock.calls.every(([path]) => !String(path).includes(oldImage.hash))).toBe(true);
	});

	it('rejects an envelope the relay moved from another slot', async () => {
		const account = createSyncIdentity();
		const otherSlot = await sha256(`${account.syncKey}\u0000note:other-note`);
		const note = {
			id: 'wanted-note',
			title: 'Other note',
			body: 'Not this note',
			color: 'default',
			pinned: false,
			archived: false,
			trashed: false,
			createdAt: 1,
			updatedAt: 1,
			labels: []
		};
		// A relay serves another slot's ciphertext and labels it with that slot, so it opens.
		const moved = {
			id: 'moved',
			slot: otherSlot,
			ciphertext: encryptSyncPayload(account.syncKey, { kind: 'note', value: note }, otherSlot)
		};
		vi.spyOn(syncStore, 'authorizedFetch').mockImplementation(async (path) => {
			const body = String(path).includes('?id=')
				? moved
				: { entries: [{ historyId: 1, savedAt: 1 }], nextBefore: null };
			return new Response(JSON.stringify(body), {
				headers: { 'content-type': 'application/json' }
			});
		});
		await expect(loadNoteHistory(account, 'wanted-note')).rejects.toThrow(
			'Could not read an encrypted history version.'
		);
	});
});
