import { describe, expect, it } from 'vitest';
import { mergeTwoNotes, retargetLocalNotes } from './merge';
import { applyNoteEdit, type EditContext } from './edit';
import { BodyAuthor } from './bodyDoc';
import { stableStringify } from './stableStringify';
import type { Note, NoteImage } from './types';

function image(id: string, dataUrl: string): NoteImage {
	return { id, name: `${id}.jpg`, mime: 'image/jpeg', dataUrl, createdAt: 1 };
}

function note(updatedAt: number, images: NoteImage[]): Note {
	return {
		id: 'note',
		title: '',
		body: '',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt,
		reminder: null,
		labels: [],
		images
	};
}

const context = (writer: string, at: number): EditContext => ({
	now: () => at,
	writer,
	author: new BodyAuthor()
});

describe('mergeTwoNotes', () => {
	it('merges concurrent body edits from two devices instead of dropping one', () => {
		const base = applyNoteEdit(note(1, []), { body: 'milk\neggs\nbread' }, context('a', 5));
		const phone = applyNoteEdit(base, { body: 'oat milk\neggs\nbread' }, context('phone', 10));
		const laptop = applyNoteEdit(base, { body: 'milk\neggs\nbread\nbutter' }, context('laptop', 9));

		const merged = mergeTwoNotes(phone, laptop);
		expect(merged.body).toBe('oat milk\neggs\nbread\nbutter');
		// Every device must store identical bytes, or they re-upload each other forever.
		expect(stableStringify(mergeTwoNotes(laptop, phone))).toBe(stableStringify(merged));
	});

	it('merges a legacy body without a document into the same text, not a duplicate', () => {
		const legacy = { ...note(1, []), body: 'shared text' };
		const edited = applyNoteEdit(legacy, { body: 'shared text, edited' }, context('a', 5));

		expect(mergeTwoNotes(legacy, edited).body).toBe('shared text, edited');
		expect(mergeTwoNotes(edited, legacy).body).toBe('shared text, edited');
	});

	it('keeps last-write-wins for bodies when neither copy has a document', () => {
		const older = { ...note(1, []), body: 'older', fieldTimes: { body: 1 } };
		const newer = { ...note(2, []), body: 'newer', fieldTimes: { body: 2 } };
		expect(mergeTwoNotes(older, newer).body).toBe('newer');
	});

	it('breaks equal field times by writer, not by value', () => {
		const left = {
			...note(5, []),
			title: 'zzz',
			fieldTimes: { title: 5 },
			fieldWriters: { title: 'a' }
		};
		const right = {
			...note(5, []),
			title: 'aaa',
			fieldTimes: { title: 5 },
			fieldWriters: { title: 'b' }
		};
		expect(mergeTwoNotes(left, right).title).toBe('aaa');
		expect(mergeTwoNotes(right, left).title).toBe('aaa');
	});

	it('keeps a newer body when the other device only changed pin', () => {
		const edited = { ...note(10, []), body: 'edited', fieldTimes: { body: 20, pinned: 10 } };
		const pinned = {
			...note(15, []),
			body: '',
			pinned: true,
			fieldTimes: { body: 10, pinned: 15 }
		};
		const merged = mergeTwoNotes(edited, pinned);
		expect(merged.body).toBe('edited');
		expect(merged.pinned).toBe(true);
	});

	it('keeps attachments added on both devices', () => {
		const base = note(1, []);
		const phone = applyNoteEdit(
			base,
			{ images: [{ ...image('photo', 'data:p'), createdAt: 2 }] },
			context('p', 5)
		);
		const laptop = applyNoteEdit(
			base,
			{ images: [{ ...image('scan', 'data:s'), createdAt: 3 }] },
			context('l', 6)
		);

		expect(mergeTwoNotes(phone, laptop).images?.map((item) => item.id)).toEqual(['photo', 'scan']);
		expect(mergeTwoNotes(laptop, phone).images?.map((item) => item.id)).toEqual(['photo', 'scan']);
	});

	it('does not bring back an attachment removed on another device', () => {
		const both = note(1, [image('keep', ''), image('gone', '')]);
		const removed = applyNoteEdit(both, { images: [image('keep', '')] }, context('a', 5));

		expect(mergeTwoNotes(both, removed).images?.map((item) => item.id)).toEqual(['keep']);
		expect(mergeTwoNotes(removed, both).images?.map((item) => item.id)).toEqual(['keep']);
	});

	it('keeps the later content edit of one attachment', () => {
		const original = note(1, [{ ...image('one', ''), contentHash: 'old' }]);
		const cropped = applyNoteEdit(
			original,
			{ images: [{ ...image('one', 'data:cropped'), contentHash: 'new' }] },
			context('a', 5)
		);

		expect(mergeTwoNotes(original, cropped).images?.[0].contentHash).toBe('new');
		expect(mergeTwoNotes(cropped, original).images?.[0].contentHash).toBe('new');
	});

	it('fills a missing thumb from the other copy of the same attachment', () => {
		const stored = note(10, [{ ...image('one', ''), thumbUrl: 'data:image/jpeg;base64,thumb' }]);
		const mirrored = note(10, [image('one', '')]);

		expect(mergeTwoNotes(mirrored, stored).images).toEqual([
			{ ...image('one', ''), thumbUrl: 'data:image/jpeg;base64,thumb' }
		]);
	});
});

describe('retargetLocalNotes', () => {
	it('gives the local copy a new id when the account already has that note', () => {
		const local = { ...note(10, [image('photo', 'data:local')]), id: 'shared', title: 'mine' };
		const remote = { ...note(8, [image('photo', 'data:remote')]), id: 'shared', title: 'theirs' };
		let next = 0;
		const remapped = retargetLocalNotes([local], [remote], {}, () => `new-${++next}`);

		expect(remapped).toEqual([
			{
				...local,
				id: 'new-2',
				images: [{ ...image('photo', 'data:local'), id: 'new-1' }]
			}
		]);
		expect(remapped[0]?.id).not.toBe('shared');
		expect(remapped[0]?.images?.[0]?.id).not.toBe('photo');
	});

	it('keeps a local note that a remote tombstone would otherwise drop', () => {
		const local = { ...note(10, []), id: 'deleted-on-server', title: 'still on this phone' };
		let next = 0;
		const remapped = retargetLocalNotes(
			[local],
			[],
			{ 'deleted-on-server': 5 },
			() => `kept-${++next}`
		);

		expect(remapped[0]?.id).toBe('kept-1');
		expect(remapped[0]?.title).toBe('still on this phone');
	});

	it('leaves local-only notes and photos alone', () => {
		const local = { ...note(10, [image('only-here', 'data:x')]), id: 'local-1', title: 'mine' };
		const remote = { ...note(8, [image('cloud-photo', 'data:y')]), id: 'cloud-1', title: 'theirs' };
		const remapped = retargetLocalNotes([local], [remote], {}, () => 'should-not-run');

		expect(remapped).toEqual([local]);
	});
});
