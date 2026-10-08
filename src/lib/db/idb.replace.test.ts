import { describe, expect, it, vi } from 'vitest';
import type { Label, Note, NoteImage } from '#lib/types.js';
import {
	bulkPutLabels,
	getAllLabels,
	getAllNotesMetadata,
	hydrateNoteAttachments,
	NOTES_STORE,
	putNote,
	replaceAllDeviceData
} from './idb';

const originalPut = IDBObjectStore.prototype.put;

function photo(id: string): NoteImage {
	return {
		id,
		name: `${id}.png`,
		mime: 'image/png',
		dataUrl:
			'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
		createdAt: 1
	};
}
import { TEST_WORKSPACE } from '../../tests/workspace';

function note(id: string, title: string): Note {
	return {
		id,
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
		labels: []
	};
}

function label(id: string, name: string): Label {
	return { id, name, createdAt: 1, updatedAt: 1 };
}

describe('replaceAllDeviceData', () => {
	it('keeps the downloaded device state when an earlier same-note save is still queued', async () => {
		const firstLocalSave = putNote(TEST_WORKSPACE, note('local', 'first local write'));
		const staleLocalSave = putNote(TEST_WORKSPACE, note('local', 'late local write'));
		const replacement = replaceAllDeviceData(
			TEST_WORKSPACE,
			[note('cloud', 'downloaded cloud note')],
			[label('cloud-label', 'Cloud')]
		);

		await Promise.all([firstLocalSave, staleLocalSave, replacement]);

		expect(
			(await getAllNotesMetadata(TEST_WORKSPACE)).map(({ id, title }) => ({ id, title }))
		).toEqual([{ id: 'cloud', title: 'downloaded cloud note' }]);
		expect(await getAllLabels(TEST_WORKSPACE)).toEqual([label('cloud-label', 'Cloud')]);
	});

	it('leaves the device as it was when one note cannot be decoded', async () => {
		await putNote(TEST_WORKSPACE, note('kept', 'already here'));
		await bulkPutLabels(TEST_WORKSPACE, [label('kept-label', 'Kept')]);
		const broken = {
			...note('broken', 'undecodable attachment'),
			images: [
				{
					id: 'img',
					mime: 'image/png',
					dataUrl: 'not-a-valid-url',
					createdAt: 1
				} as NoteImage
			]
		};

		await expect(
			replaceAllDeviceData(
				TEST_WORKSPACE,
				[broken, note('good', 'would land')],
				[label('new', 'New')]
			)
		).rejects.toThrow('Not a valid image URL');

		expect((await getAllNotesMetadata(TEST_WORKSPACE)).map(({ id }) => id)).toEqual(['kept']);
		expect(await getAllLabels(TEST_WORKSPACE)).toEqual([label('kept-label', 'Kept')]);
	});

	it('keeps the old set, attachments included, when a write fails part-way through', async () => {
		const existing = { ...note('kept', 'already here'), images: [photo('old-shot')] };
		await putNote(TEST_WORKSPACE, existing);
		await bulkPutLabels(TEST_WORKSPACE, [label('kept-label', 'Kept')]);
		const committed: string[] = [];
		// The second note's row is refused, as a full disk refuses one.
		const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
			this: IDBObjectStore,
			value: unknown,
			key?: IDBValidKey
		) {
			if (this.name === NOTES_STORE && (value as Note).id === 'second') {
				throw new DOMException('Storage full', 'QuotaExceededError');
			}
			return originalPut.call(this, value, key);
		});

		await expect(
			replaceAllDeviceData(
				TEST_WORKSPACE,
				[
					{ ...note('first', 'first new'), images: [photo('new-shot')] },
					note('second', 'second new')
				],
				[label('new', 'New')],
				(item) => {
					committed.push(item.id);
				}
			)
		).rejects.toThrow('Storage full');
		put.mockRestore();

		expect((await getAllNotesMetadata(TEST_WORKSPACE)).map(({ id }) => id)).toEqual(['kept']);
		expect(await getAllLabels(TEST_WORKSPACE)).toEqual([label('kept-label', 'Kept')]);
		const hydrated = await hydrateNoteAttachments(TEST_WORKSPACE, existing);
		expect(hydrated.images?.[0]?.dataUrl).toBe(photo('old-shot').dataUrl);
		expect(committed).toEqual([]);
	});

	it('reports every note committed only once the whole set is durable', async () => {
		const committed: string[] = [];
		await replaceAllDeviceData(
			TEST_WORKSPACE,
			[note('a', 'A'), note('b', 'B')],
			[],
			async (item) => {
				expect((await getAllNotesMetadata(TEST_WORKSPACE)).map(({ id }) => id)).toEqual(['a', 'b']);
				committed.push(item.id);
			}
		);
		expect(committed).toEqual(['a', 'b']);
	});
});
