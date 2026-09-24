import { describe, expect, it, vi } from 'vitest';
import type { Note } from '$lib/types';
import { withoutAttachmentsHistoryNeeds } from './attachmentRetention';

function note(id: string, imageTombstones?: Record<string, number>): Note {
	return {
		id,
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
		...(imageTombstones ? { imageTombstones } : {})
	};
}

describe('withoutAttachmentsHistoryNeeds', () => {
	const keys = ['attachment:kept', 'attachment:rolled-off', 'attachment:orphan', 'note:gone'];

	it('keeps an image a live note removed while a retained version still shows it', async () => {
		const history = vi.fn(async () => new Set(['kept']));
		const result = await withoutAttachmentsHistoryNeeds(
			keys,
			[note('photos', { kept: 5, 'rolled-off': 3 })],
			{},
			history
		);
		expect(result).toEqual(['attachment:rolled-off', 'attachment:orphan', 'note:gone']);
		expect(history).toHaveBeenCalledTimes(1);
	});

	it('deletes the images of a note deleted for good at once, without reading its history', async () => {
		const history = vi.fn(async () => new Set(['kept']));
		const result = await withoutAttachmentsHistoryNeeds(
			keys,
			[note('photos', { kept: 5 })],
			{ photos: 9 },
			history
		);
		expect(result).toEqual(keys);
		expect(history).not.toHaveBeenCalled();
	});

	it('keeps everything a note removed when its history cannot be read', async () => {
		const result = await withoutAttachmentsHistoryNeeds(
			keys,
			[note('photos', { kept: 5, 'rolled-off': 3 })],
			{},
			async () => null
		);
		expect(result).toEqual(['attachment:orphan', 'note:gone']);
	});

	it('reads no history when nothing being deleted is an attachment', async () => {
		const history = vi.fn(async () => new Set<string>());
		expect(
			await withoutAttachmentsHistoryNeeds(['note:gone'], [note('photos', { a: 1 })], {}, history)
		).toEqual(['note:gone']);
		expect(history).not.toHaveBeenCalled();
	});
});
