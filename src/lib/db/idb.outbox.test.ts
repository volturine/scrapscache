import { describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import {
	clearSyncOutbox,
	commitSyncControl,
	deleteLabelWithSyncState,
	getAllLabels,
	getAllNotesMetadata,
	getSyncOutboxKeys,
	getSyncState,
	getOutboxGeneration,
	hydrateNoteAttachments,
	markSyncOutbox,
	putLabel,
	putNote,
	setSyncState
} from './idb';
import { TEST_WORKSPACE } from '../../tests/workspace';

function note(title: string): Note {
	return {
		id: 'atomic-note',
		title,
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
		images: []
	};
}

describe('durable sync outbox', () => {
	it('stores a note that the next case must not see', async () => {
		await putNote(TEST_WORKSPACE, note('isolation-note'));
		expect((await getAllNotesMetadata(TEST_WORKSPACE)).map(({ title }) => title)).toEqual([
			'isolation-note'
		]);
	});

	it('starts the next case with an empty database', async () => {
		expect(await getAllNotesMetadata(TEST_WORKSPACE)).toEqual([]);
	});

	it('deduplicates keys and clears only acknowledged generations', async () => {
		await markSyncOutbox(TEST_WORKSPACE, ['note:one', 'note:one', 'label:two']);
		expect((await getSyncOutboxKeys(TEST_WORKSPACE)).sort()).toEqual(['label:two', 'note:one']);

		await clearSyncOutbox(TEST_WORKSPACE, ['note:one'], 0);
		expect((await getSyncOutboxKeys(TEST_WORKSPACE)).sort()).toEqual(['label:two', 'note:one']);

		await clearSyncOutbox(TEST_WORKSPACE, ['note:one', 'label:two']);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
	});

	it('clears an internally marked generation without clearing a later edit', async () => {
		const first = await markSyncOutbox(TEST_WORKSPACE, ['note:one']);
		await clearSyncOutbox(TEST_WORKSPACE, ['note:one'], first - 1);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(['note:one']);

		const second = await markSyncOutbox(TEST_WORKSPACE, ['note:one']);
		await clearSyncOutbox(TEST_WORKSPACE, ['note:one'], first);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(['note:one']);

		await clearSyncOutbox(TEST_WORKSPACE, ['note:one'], second);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
	});

	it('allocates strictly increasing generations even when the clock jumps backward', async () => {
		const realNow = Date.now;
		vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
		const first = await markSyncOutbox(TEST_WORKSPACE, ['note:a']);
		Date.now = () => 500;
		const second = await markSyncOutbox(TEST_WORKSPACE, ['note:b']);
		Date.now = realNow;

		expect(second).toBeGreaterThan(first);
		expect(await getOutboxGeneration(TEST_WORKSPACE)).toBe(second);
	});

	it('rolls back cursor and outbox changes together when a control write fails', async () => {
		await setSyncState(TEST_WORKSPACE, 'test-cursor', 4);
		const marked = await markSyncOutbox(TEST_WORKSPACE, [`note:atomic`]);

		await expect(
			commitSyncControl(
				TEST_WORKSPACE,
				[
					['test-cursor', 5],
					['uncloneable-value', () => undefined]
				],
				[{ keys: ['note:atomic'], through: marked }]
			)
		).rejects.toThrow();

		expect(await getSyncState(TEST_WORKSPACE, 'test-cursor')).toBe(4);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(['note:atomic']);
	});

	it('commits a label and its outbox marker together or rolls both back', async () => {
		await clearSyncOutbox(TEST_WORKSPACE, await getSyncOutboxKeys(TEST_WORKSPACE));
		const label = {
			id: 'atomic-label',
			name: 'saved',
			createdAt: 1,
			updatedAt: 1
		};
		await putLabel(TEST_WORKSPACE, label, ['label:atomic-label']);
		expect((await getAllLabels(TEST_WORKSPACE)).find(({ id }) => id === 'atomic-label')?.name).toBe(
			'saved'
		);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(['label:atomic-label']);

		await clearSyncOutbox(TEST_WORKSPACE, ['label:atomic-label']);
		await expect(
			putLabel(TEST_WORKSPACE, { ...label, name: 'must roll back' }, [
				Number.NaN as unknown as string
			])
		).rejects.toThrow();
		expect((await getAllLabels(TEST_WORKSPACE)).find(({ id }) => id === 'atomic-label')?.name).toBe(
			'saved'
		);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
	});

	it('commits label deletion, its tombstone, and outbox marker in one transaction', async () => {
		const label = { id: 'deleted-label', name: 'Delete me', createdAt: 1, updatedAt: 1 };
		await putLabel(TEST_WORKSPACE, label);
		await deleteLabelWithSyncState(
			TEST_WORKSPACE,
			label.id,
			[['label-tombstones', { [label.id]: 123 }]],
			[`label-tombstone:${label.id}`]
		);
		expect(await getAllLabels(TEST_WORKSPACE)).toEqual([]);
		expect(await getSyncState(TEST_WORKSPACE, 'label-tombstones')).toEqual({ [label.id]: 123 });
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([`label-tombstone:${label.id}`]);

		await clearSyncOutbox(TEST_WORKSPACE, await getSyncOutboxKeys(TEST_WORKSPACE));
		await putLabel(TEST_WORKSPACE, label);
		await expect(
			deleteLabelWithSyncState(
				TEST_WORKSPACE,
				label.id,
				[['label-tombstones', () => undefined]],
				[`label-tombstone:${label.id}`]
			)
		).rejects.toThrow();
		expect((await getAllLabels(TEST_WORKSPACE)).map(({ id }) => id)).toEqual([label.id]);
		expect(await getSyncState(TEST_WORKSPACE, 'label-tombstones')).toEqual({ [label.id]: 123 });
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
	});

	it('commits a note and its outbox marker together or rolls both back', async () => {
		await clearSyncOutbox(TEST_WORKSPACE, await getSyncOutboxKeys(TEST_WORKSPACE));
		await putNote(TEST_WORKSPACE, note('before'));

		await putNote(TEST_WORKSPACE, note('saved'), ['note:atomic-note', 'note:atomic-note']);
		expect(
			(await getAllNotesMetadata(TEST_WORKSPACE)).find(({ id }) => id === 'atomic-note')?.title
		).toBe('saved');
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(['note:atomic-note']);

		await clearSyncOutbox(TEST_WORKSPACE, ['note:atomic-note']);
		await expect(
			putNote(TEST_WORKSPACE, note('must roll back'), [Number.NaN as unknown as string])
		).rejects.toThrow();
		expect(
			(await getAllNotesMetadata(TEST_WORKSPACE)).find(({ id }) => id === 'atomic-note')?.title
		).toBe('saved');
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual([]);
	});

	it('keeps photo blobs after a later metadata-only save', async () => {
		const withPhoto = {
			...note('photo'),
			id: 'photo-note',
			images: [
				{
					id: 'pic',
					mime: 'image/png',
					dataUrl: 'data:image/png;base64,QQ==',
					createdAt: 1,
					contentHash: 'hash-pic'
				}
			]
		};
		await putNote(TEST_WORKSPACE, withPhoto, ['note:photo-note', 'attachment:pic']);
		await putNote(
			TEST_WORKSPACE,
			{
				...withPhoto,
				title: 'metadata only',
				images: [{ ...withPhoto.images[0], dataUrl: '' }]
			},
			['note:photo-note']
		);
		const hydrated = await hydrateNoteAttachments(
			TEST_WORKSPACE,
			(await getAllNotesMetadata(TEST_WORKSPACE)).find((item) => item.id === 'photo-note')!
		);
		expect(hydrated.images?.[0]?.dataUrl?.startsWith('data:image/png;base64,')).toBe(true);
	});

	it('keeps existing photo blobs when a replacement note has no bytes yet', async () => {
		const withPhoto = {
			...note('photo'),
			id: 'photo-note',
			images: [
				{
					id: 'old',
					mime: 'image/png',
					dataUrl: 'data:image/png;base64,QQ==',
					createdAt: 1,
					contentHash: 'hash-old'
				}
			]
		};
		await putNote(TEST_WORKSPACE, withPhoto);
		await putNote(TEST_WORKSPACE, {
			...withPhoto,
			images: [
				{
					id: 'new',
					mime: 'image/png',
					dataUrl: '',
					createdAt: 2,
					contentHash: 'hash-new'
				}
			]
		});
		const metadata = (await getAllNotesMetadata(TEST_WORKSPACE)).find(
			(item) => item.id === 'photo-note'
		)!;
		const hydrated = await hydrateNoteAttachments(TEST_WORKSPACE, {
			...metadata,
			images: withPhoto.images.map((image) => ({ ...image, dataUrl: '' }))
		});
		expect(hydrated.images?.[0]?.dataUrl?.startsWith('data:image/png;base64,')).toBe(true);
	});
});
