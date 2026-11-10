import { describe, expect, it } from 'vitest';
import { mergeHydratedImages } from './noteAttachmentHydration';
import type { NoteImage } from './types';

function image(id: string, dataUrl = ''): NoteImage {
	return { id, mime: 'image/jpeg', dataUrl, createdAt: 1 };
}

describe('mergeHydratedImages', () => {
	it('fills only unloaded placeholders and preserves the current attachment list', () => {
		const current = [image('stored'), image('new', 'data:new')];
		const hydrated = [image('stored', 'data:stored')];

		expect(mergeHydratedImages(current, hydrated)).toEqual([
			image('stored', 'data:stored'),
			image('new', 'data:new')
		]);
	});

	it('does not resurrect an attachment removed while loading', () => {
		expect(
			mergeHydratedImages(
				[image('kept')],
				[image('removed', 'data:removed'), image('kept', 'data:kept')]
			)
		).toEqual([image('kept', 'data:kept')]);
	});

	it('does not fill a photo ref from bytes for a different crop with the same id', () => {
		const current = [{ ...image('photo'), contentHash: 'new-hash', thumbUrl: 'thumb:new' }];
		const hydrated = [{ ...image('photo', 'data:old'), contentHash: 'old-hash' }];

		expect(mergeHydratedImages(current, hydrated)).toEqual(current);
	});

	it('fills a cold ref when its expected hash matches the loaded bytes', () => {
		const current = [{ ...image('photo'), contentHash: 'same-hash', thumbUrl: 'thumb:same' }];
		const hydrated = [{ ...image('photo', 'data:photo'), contentHash: 'same-hash' }];

		expect(mergeHydratedImages(current, hydrated)).toEqual([
			{
				...image('photo', 'data:photo'),
				contentHash: 'same-hash',
				thumbUrl: 'thumb:same'
			}
		]);
	});
});
