import { describe, expect, it } from 'vitest';
import type { Note, NoteImage } from './types';
import { applyNoteEdit, stampNewNote, touchNoteFields, type EditContext } from './edit';
import { BodyAuthor } from './bodyDoc';
import { mergeTwoNotes, NOTE_FIELDS } from './merge';

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

	it('keeps untouched fields at their old times on notes without field times', () => {
		// Older records carried only updatedAt; an edit bumps it, and a field left
		// to fall back on it would look as new as the edit and beat a newer one.
		const legacy = note({ updatedAt: 10, fieldTimes: undefined });
		const pinned = applyNoteEdit(legacy, { pinned: true }, context(50, 'phone'));
		const recolored = applyNoteEdit(legacy, { color: 'red' }, context(40, 'laptop'));

		const merged = mergeTwoNotes(pinned, recolored);
		expect(merged).toMatchObject({ pinned: true, color: 'red' });
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

	it('clears a tombstone when an edit puts that attachment back', () => {
		const stored = note({ images: [], imageTombstones: { back: 40 } });
		const edited = applyNoteEdit(stored, { images: [image('back')] }, context(50));

		expect(edited.images?.map((item) => item.id)).toEqual(['back']);
		expect(edited.imageTombstones).toBeUndefined();
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

describe('stampNewNote', () => {
	const fresh = () => note({ createdAt: 40, updatedAt: 40, fieldTimes: undefined });

	it('writes every field at the creation time, so the note was never edited', () => {
		const created = stampNewNote(fresh(), 'me');

		expect(created.updatedAt).toBe(created.createdAt);
		expect(created.fieldTimes).toEqual(Object.fromEntries(NOTE_FIELDS.map((field) => [field, 40])));
		expect(created.fieldWriters).toEqual(
			Object.fromEntries(NOTE_FIELDS.map((field) => [field, 'me']))
		);
	});

	it('lets an edit in the same millisecond stamp past it and win the merge', () => {
		const created = stampNewNote(fresh(), 'me');
		const edited = applyNoteEdit(created, { title: 'Renamed' }, context(40));

		expect(edited.fieldTimes?.title).toBe(41);
		expect(edited.updatedAt).toBeGreaterThan(edited.createdAt);
		expect(mergeTwoNotes(created, edited).title).toBe('Renamed');
		expect(mergeTwoNotes(edited, created).title).toBe('Renamed');
	});
});

describe('a repeating reminder', () => {
	const daily = { unit: 'day', every: 1, zone: 'UTC' } as const;
	const weekly = { unit: 'week', every: 1, zone: 'UTC' } as const;

	it('is written with its reminder, under the reminder field', () => {
		const base = note({ reminder: 500 });
		const repeated = applyNoteEdit(base, { repeat: daily }, context(1_000));
		expect(repeated.repeat).toEqual(daily);
		expect(repeated.fieldTimes?.reminder).toBe(1_000);
		expect(applyNoteEdit(repeated, { repeat: { ...daily } }, context(2_000))).toBe(repeated);
		// A new time keeps the repeat.
		expect(applyNoteEdit(repeated, { reminder: 600 }, context(2_000)).repeat).toEqual(daily);
	});

	it('goes with the reminder taken away, and never stands alone', () => {
		const repeated = note({ reminder: 500, repeat: daily });
		const removed = applyNoteEdit(repeated, { reminder: null }, context(1_000));
		expect(removed.reminder).toBeNull();
		expect(removed).not.toHaveProperty('repeat');
		expect(applyNoteEdit(note(), { repeat: daily }, context(1_000))).toEqual(note());
	});

	it('merges with its reminder as one value, the later write winning both', () => {
		const base = note({ reminder: 500 });
		const timeOnly = applyNoteEdit(base, { reminder: 700 }, context(1_000, 'a'));
		const repeatOnly = applyNoteEdit(base, { repeat: weekly }, context(2_000, 'b'));
		for (const merged of [
			mergeTwoNotes(timeOnly, repeatOnly),
			mergeTwoNotes(repeatOnly, timeOnly)
		]) {
			expect(merged.reminder).toBe(500);
			expect(merged.repeat).toEqual(weekly);
		}
		const cleared = applyNoteEdit(repeatOnly, { reminder: null }, context(3_000, 'a'));
		expect(mergeTwoNotes(cleared, repeatOnly)).not.toHaveProperty('repeat');
	});
});

describe('a repeat at a tie', () => {
	it('survives a copy from an app that dropped it under the same write', () => {
		const repeated = note({
			reminder: 500,
			repeat: { unit: 'day', every: 1, zone: 'UTC' },
			fieldTimes: { reminder: 9 },
			fieldWriters: { reminder: 'w' }
		});
		const { repeat: _dropped, ...stripped } = repeated;
		expect(mergeTwoNotes(stripped, repeated).repeat).toEqual(repeated.repeat);
		expect(mergeTwoNotes(repeated, stripped).repeat).toEqual(repeated.repeat);
	});
});
