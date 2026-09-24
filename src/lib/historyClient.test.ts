import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncIdentity, encryptSyncPayload } from '$lib/syncPairing';
import { sha256 } from '$lib/syncHash';
import { syncStore } from '$lib/stores/sync.svelte';
import { hydrateHistoryNote, loadNoteHistory } from './historyClient';

afterEach(() => vi.restoreAllMocks());

function respond(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function note(id: string, patch: Record<string, unknown> = {}) {
	return {
		id,
		title: 'Earlier title',
		body: 'Earlier body',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		createdAt: 1,
		updatedAt: 1,
		labels: [],
		...patch
	};
}

describe('encrypted note history', () => {
	it('loads a note’s versions in one request and its matching attachment at that time', async () => {
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
		const version = note('old-note', {
			images: [{ id: attachment.id, mime: attachment.mime, createdAt: 1, hash: attachment.hash }]
		});
		const fetch = vi.spyOn(syncStore, 'authorizedFetch').mockImplementation(async (path) =>
			String(path).includes('&at=')
				? respond({
						id: 'old-attachment',
						slot: imageSlot,
						ciphertext: encryptSyncPayload(
							account.syncKey,
							{ kind: 'attachment', value: attachment },
							imageSlot
						)
					})
				: respond({
						versions: [
							{
								historyId: 1,
								savedAt,
								id: 'old-version',
								ciphertext: encryptSyncPayload(
									account.syncKey,
									{ kind: 'note', value: version },
									noteSlot
								)
							}
						]
					})
		);

		const entries = await loadNoteHistory(account, 'old-note');
		expect(entries.map((entry) => [entry.historyId, entry.note.title])).toEqual([
			[1, 'Earlier title']
		]);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith(
			`/api/sync/history?slot=${noteSlot}`,
			{ cache: 'no-store' },
			account
		);

		const restored = await hydrateHistoryNote(account, entries[0]);
		expect(restored.images?.[0].dataUrl).toBe(attachment.dataUrl);
		expect(fetch).toHaveBeenLastCalledWith(
			`/api/sync/history?slot=${imageSlot}&at=${savedAt}`,
			{ cache: 'no-store' },
			account
		);
	});

	it('finds the attachment among its own versions when the timestamp lookup returns a newer one', async () => {
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
		const sealed = (value: typeof oldImage) =>
			encryptSyncPayload(account.syncKey, { kind: 'attachment', value }, imageSlot);
		vi.spyOn(syncStore, 'authorizedFetch').mockImplementation(async (path) =>
			String(path).includes('&at=')
				? respond({ id: 'new', slot: imageSlot, ciphertext: sealed(newImage) })
				: respond({
						versions: [
							{ historyId: 2, savedAt: 2, id: 'new', ciphertext: sealed(newImage) },
							{ historyId: 1, savedAt: 1, id: 'old', ciphertext: sealed(oldImage) }
						]
					})
		);

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
	});

	it('rejects an envelope the relay moved from another slot', async () => {
		const account = createSyncIdentity();
		const otherSlot = await sha256(`${account.syncKey}\u0000note:other-note`);
		// A relay serves another record's version in this note's list.
		vi.spyOn(syncStore, 'authorizedFetch').mockResolvedValue(
			respond({
				versions: [
					{
						historyId: 1,
						savedAt: 1,
						id: 'moved',
						ciphertext: encryptSyncPayload(
							account.syncKey,
							{ kind: 'note', value: note('wanted-note', { body: 'Not this note' }) },
							otherSlot
						)
					}
				]
			})
		);
		await expect(loadNoteHistory(account, 'wanted-note')).rejects.toThrow(
			'Could not read an encrypted history version.'
		);
	});
});
