import { describe, expect, it } from 'vitest';
import type { Note, NoteImage } from './types';
import { applyNoteEdit, touchNoteFields, type EditContext } from './edit';
import { BodyAuthor } from './bodyDoc';
import { mergeTwoNotes } from './merge';

const context = (at: number, writer = 'me'): EditContext => ({
	now: () => at,
	writer,
	author: new BodyAuthor()
});

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note',
		title: 'Title',
		body: 'Body',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		fieldTimes: { title: 1, body: 1, pinned: 1, images: 1, linkPreviews: 1 },
		...partial
	};
}

function image(id: string, partial: Partial<NoteImage> = {}): NoteImage {
	return { id, mime: 'image/png', dataUrl: '', createdAt: 1, ...partial };
}

describe('applyNoteEdit', () => {
	it('stamps only fields whose value changes', () => {
		const edited = applyNoteEdit(
			note(),
			{ title: 'Title', body: 'Body', pinned: true },
			context(50)
		);

		expect(edited.pinned).toBe(true);
		expect(edited.fieldTimes).toMatchObject({ title: 1, body: 1, pinned: 50 });
		expect(edited.fieldWriters).toEqual({ pinned: 'me' });
	});

	it('returns the same note when nothing changes', () => {
		const current = note({ linkPreviews: undefined });
		expect(applyNoteEdit(current, { title: 'Title', linkPreviews: [] }, context(50))).toBe(current);
	});

	it('advances an edit past a time pulled from a fast device clock', () => {
		const pulled = note({ title: 'from a fast clock', fieldTimes: { title: 10_000 } });
		const edited = touchNoteFields({ ...pulled, title: 'newer edit' }, ['title'], context(1_000));

		expect(edited.fieldTimes?.title).toBe(10_001);
		expect(mergeTwoNotes(pulled, edited).title).toBe('newer edit');
	});

	it('writes body edits into the body document', () => {
		const edited = applyNoteEdit(note(), { body: 'Body, edited' }, context(50));
		expect(edited.body).toBe('Body, edited');
		expect(edited.bodyDoc).toEqual(expect.any(String));
	});

	it('remembers removed attachments and keeps what the store knows about the rest', () => {
		const stored = note({ images: [image('keep', { contentHash: 'h1' }), image('drop')] });
		// An editor draft of `keep` that has not seen its hash yet is not a change to it.
		const edited = applyNoteEdit(stored, { images: [image('keep')] }, context(50));

		expect(edited.images).toEqual([image('keep', { contentHash: 'h1' })]);
		expect(edited.imageTombstones).toEqual({ drop: 50 });
	});

	it('records when an attachment content changes', () => {
		const stored = note({ images: [image('one', { contentHash: 'old' })] });
		const edited = applyNoteEdit(
			stored,
			{ images: [image('one', { contentHash: 'new' })] },
			context(50)
		);
		expect(edited.images?.[0]).toMatchObject({ contentHash: 'new', editedAt: 50 });
	});
});
