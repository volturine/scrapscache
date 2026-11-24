import { createKanbanBoard } from './kanban';
import { describe, expect, it } from 'vitest';
import type { Note } from '#lib/types.js';
import {
	currentRecordKeys,
	noteRecordForRelay,
	planDeletableKeys,
	reconcileBaseline,
	relayHeldVersions,
	syncRoundHasMore
} from './syncEngine';
import { syncSnapshot, type SyncRecord } from './syncRecords';

function note(id: string, imageIds: string[] = []): Note {
	return {
		id,
		title: id,
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
		images: imageIds.map((imageId) => ({
			id: imageId,
			mime: 'image/jpeg',
			dataUrl: '',
			createdAt: 1
		}))
	};
}

describe('incremental sync engine', () => {
	it('keeps a board that was put back after its delete, and still drops one that was not', () => {
		const restored = { ...createKanbanBoard('Put back'), id: 'restored', updatedAt: 20 };
		const deleted = { ...createKanbanBoard('Deleted'), id: 'deleted', updatedAt: 5 };
		const snapshot = syncSnapshot({
			boards: [restored, deleted],
			boardTombstones: { restored: 10, deleted: 10 }
		});

		const current = currentRecordKeys(snapshot);
		expect(current.has('board:restored')).toBe(true);
		expect(current.has('board:deleted')).toBe(false);
		// Its record on the relay stays; the deleted board's goes.
		expect(
			planDeletableKeys({
				recordIds: { 'board:restored': 'r', 'board:deleted': 'd' },
				snapshot,
				pullOnly: false,
				catchUpComplete: true
			})
		).toEqual(['board:deleted']);
	});

	it('does not delete attachments until catch-up has drained', () => {
		const planned = planDeletableKeys({
			recordIds: { 'attachment:pic': 'env-1', 'note:n1': 'env-2' },
			snapshot: syncSnapshot(),
			pullOnly: false,
			catchUpComplete: false
		});
		expect(planned).toEqual([]);
	});

	it('deletes an unused attachment only after catch-up completes', () => {
		const planned = planDeletableKeys({
			recordIds: { 'attachment:pic': 'env-1', 'note:n1': 'env-2' },
			snapshot: syncSnapshot({ notes: [note('n1')] }),
			pullOnly: false,
			catchUpComplete: true
		});
		expect(planned).toEqual(['attachment:pic']);
	});

	it('does not delete an old photo while a replacement is not yet on the relay', () => {
		const planned = planDeletableKeys({
			recordIds: { 'attachment:old': 'env-1', 'note:n1': 'env-2' },
			snapshot: syncSnapshot({ notes: [note('n1', ['new'])] }),
			pullOnly: false,
			catchUpComplete: true
		});
		expect(planned).toEqual([]);
	});

	it('never deletes slots during pull-only replace', () => {
		const planned = planDeletableKeys({
			recordIds: { 'attachment:pic': 'env-1', 'note:n1': 'env-2' },
			snapshot: syncSnapshot(),
			pullOnly: true,
			catchUpComplete: true
		});
		expect(planned).toEqual([]);
	});

	it('runs another round when catch-up reveals an orphaned photo slot', () => {
		const pendingDeletes =
			planDeletableKeys({
				recordIds: { 'attachment:pic': 'env-1', 'note:n1': 'env-2' },
				snapshot: syncSnapshot({ tombstones: { n1: 2 } }),
				pullOnly: false,
				catchUpComplete: true
			}).length > 0;

		expect(
			syncRoundHasMore({
				remoteHasMore: false,
				remainingUploads: false,
				pendingDeletes
			})
		).toBe(true);
	});

	it('stops after the cleanup round removes the orphaned slot id', () => {
		expect(
			syncRoundHasMore({
				remoteHasMore: false,
				remainingUploads: false,
				pendingDeletes: false
			})
		).toBe(false);
	});

	it('re-uploads when local merge beats a stale remote fingerprint', () => {
		const result = reconcileBaseline({
			previous: { 'note:n1': 'local-fp' },
			uploaded: {},
			remote: { 'note:n1': 'stale-fp' },
			merged: { 'note:n1': 'local-fp' },
			currentKeys: new Set(['note:n1']),
			referencedAttachments: new Set(),
			catchUpComplete: true
		});
		expect(result.dirtyKeys).toEqual(['note:n1']);
		expect(result.baseline['note:n1']).toBe('stale-fp');
		expect(result.ackKeys).toEqual([]);
	});

	it('keeps an attachment downloaded before its note as the cloud copy until catch-up ends', () => {
		const early = reconcileBaseline({
			previous: {},
			uploaded: {},
			remote: { 'attachment:a1': 'cloud-fp' },
			merged: {},
			currentKeys: new Set(),
			referencedAttachments: new Set(),
			catchUpComplete: false
		});
		expect(early.baseline).toEqual({ 'attachment:a1': 'cloud-fp' });
		expect(early.dirtyKeys).toEqual([]);

		// The note arrives later, so the attachment is not re-uploaded.
		const withNote = reconcileBaseline({
			previous: early.baseline,
			uploaded: {},
			remote: { 'note:n1': 'note-fp' },
			merged: { 'note:n1': 'note-fp' },
			currentKeys: new Set(['note:n1', 'attachment:a1']),
			referencedAttachments: new Set(['a1']),
			catchUpComplete: true
		});
		expect(withNote.baseline).toEqual({ 'note:n1': 'note-fp', 'attachment:a1': 'cloud-fp' });

		// One no note ever shows is forgotten once catch-up ends.
		const orphan = reconcileBaseline({
			previous: early.baseline,
			uploaded: {},
			remote: {},
			merged: {},
			currentKeys: new Set(),
			referencedAttachments: new Set(),
			catchUpComplete: true
		});
		expect(orphan.baseline).toEqual({});
	});

	it('acks an outbox key only when merged state matches the upload', () => {
		const result = reconcileBaseline({
			previous: {},
			uploaded: { 'note:n1': 'sent-fp' },
			remote: {},
			merged: { 'note:n1': 'sent-fp' },
			currentKeys: new Set(['note:n1']),
			referencedAttachments: new Set(),
			catchUpComplete: true
		});
		expect(result.ackKeys).toEqual(['note:n1']);
		expect(result.dirtyKeys).toEqual([]);
		expect(result.baseline['note:n1']).toBe('sent-fp');
	});

	it('deletes library slots without touching the independent reminder channel', () => {
		const wake = 'd'.repeat(43);
		const recordIds = {
			'library-item:star': 'env-1',
			'library-item:kept': 'env-2',
			[`reminder-history:gone:${wake}`]: 'env-3',
			[`reminder-history:kept:${wake}`]: 'env-4'
		};
		const planned = planDeletableKeys({
			recordIds,
			snapshot: syncSnapshot({
				notes: [note('kept')],
				tombstones: { gone: 2 },
				libraryItems: [
					{ id: 'kept', updatedAt: 1, item: { id: 'kept', created: 1, elements: [] } }
				],
				libraryTombstones: { star: 3 }
			}),
			pullOnly: false,
			catchUpComplete: true
		});
		expect(planned.sort()).toEqual(['library-item:star']);
	});
});

describe('what the relay holds of attachments', () => {
	it('counts an attachment record only while a note on the relay lists it', () => {
		const held = relayHeldVersions({
			versions: { listed: 'hash-a', unlisted: 'hash-b' },
			listed: { 'note-1': ['listed', 'never-uploaded'] }
		});

		// An unlisted record may be deleted by any device without a trace; a listed
		// id with no record was never uploaded.
		expect([...held]).toEqual([['listed', 'hash-a']]);
	});

	function noteRecord(images: Array<{ id: string; hash: string }>): SyncRecord {
		return {
			key: 'note:n1',
			fingerprint: 'all-listed',
			payload: {
				kind: 'note',
				value: {
					...note('n1'),
					images: images.map((image) => ({ ...image, mime: 'image/jpeg', createdAt: 1 }))
				}
			}
		};
	}

	it('sends a note listing only the attachment versions the relay holds', async () => {
		const record = noteRecord([
			{ id: 'held', hash: 'hash-a' },
			{ id: 'edited', hash: 'hash-new' },
			{ id: 'new', hash: 'hash-c' }
		]);

		const sent = await noteRecordForRelay(
			record,
			new Map([
				['held', 'hash-a'],
				['edited', 'hash-old']
			])
		);

		expect(sent.payload.kind === 'note' && sent.payload.value.images).toEqual([
			{ id: 'held', hash: 'hash-a', mime: 'image/jpeg', createdAt: 1 }
		]);
		expect(sent.fingerprint).not.toBe(record.fingerprint);
	});

	it('sends a note as it is once the relay holds everything it lists', async () => {
		const record = noteRecord([{ id: 'held', hash: 'hash-a' }]);

		expect(await noteRecordForRelay(record, new Map([['held', 'hash-a']]))).toBe(record);
	});
});
