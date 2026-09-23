import { describe, expect, it } from 'vitest';
import type { Note } from './types';
import { copyNote } from './copy';

describe('copyNote', () => {
	it('keeps every merge field, so storage and backups cannot drop one', () => {
		const note: Note = {
			id: 'n',
			title: 't',
			body: 'b',
			bodyDoc: 'AQ==',
			color: 'default',
			pinned: false,
			archived: false,
			trashed: false,
			trashedAt: null,
			createdAt: 1,
			updatedAt: 2,
			reminder: null,
			labels: ['l'],
			images: [{ id: 'i', mime: 'image/png', dataUrl: '', createdAt: 1, editedAt: 2 }],
			imageTombstones: { gone: 2 },
			fieldTimes: { body: 2 },
			fieldWriters: { body: 'writer' }
		};
		expect(copyNote(note)).toEqual(note);
	});

	it('drops malformed merge metadata', () => {
		const copied = copyNote({
			id: 'n',
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
			imageTombstones: { gone: 'yesterday' },
			fieldWriters: { body: 7, unknown: 'x' }
		} as unknown as Note);
		expect(copied).not.toHaveProperty('imageTombstones');
		expect(copied).not.toHaveProperty('fieldWriters');
	});
});
