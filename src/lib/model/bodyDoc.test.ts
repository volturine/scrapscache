import { describe, expect, it } from 'vitest';
import { BodyAuthor, isReadableBodyDoc, mergeBodies } from './bodyDoc';

describe('note body documents', () => {
	it('merges edits from three writers into the same bytes in any order', () => {
		const base = new BodyAuthor().edit('n', { body: '' }, 'alpha\nbeta\ngamma');
		const one = new BodyAuthor().edit('n', base, 'ALPHA\nbeta\ngamma');
		const two = new BodyAuthor().edit('n', base, 'alpha\nbeta\ngamma\ndelta');
		const three = new BodyAuthor().edit('n', base, 'alpha\ngamma');

		const forward = mergeBodies(mergeBodies(one, two), three);
		const backward = mergeBodies(three, mergeBodies(two, one));
		expect(forward.body).toBe('ALPHA\ngamma\ndelta');
		expect(backward).toEqual(forward);
	});

	it('derives the same document for the same text on every device', () => {
		// Two devices first editing a note from before documents must not duplicate its text.
		const phone = new BodyAuthor().edit('n', { body: 'shared' }, 'shared, phone');
		const laptop = new BodyAuthor().edit('n', { body: 'shared' }, 'laptop: shared');
		expect(mergeBodies(phone, laptop).body).toBe('laptop: shared, phone');
	});

	it('keeps a body written by a client that did not update the document', () => {
		const current = new BodyAuthor().edit('n', { body: '' }, 'first');
		const stale = { body: 'rewritten elsewhere', bodyDoc: current.bodyDoc };
		const merged = mergeBodies(stale, current);
		expect(merged.body).toBe('rewritten elsewhere');
		expect(mergeBodies(current, stale)).toEqual(merged);
	});

	it('rebuilds an unreadable document from the text', () => {
		const broken = { body: 'text survives', bodyDoc: 'not-a-yjs-update' };
		expect(isReadableBodyDoc(broken.bodyDoc)).toBe(false);
		expect(mergeBodies(broken, broken).body).toBe('text survives');
	});

	it('never reuses a clock after a note lost what this author wrote', () => {
		const author = new BodyAuthor();
		const base = new BodyAuthor().edit('n', { body: '' }, 'base');
		const kept = author.edit('n', base, 'base + kept');
		// A replacement dropped `kept`; the next edit must not collide with it.
		const next = author.edit('n', base, 'base + next');
		expect(mergeBodies(kept, next).body).toContain('kept');
		expect(mergeBodies(kept, next).body).toContain('next');
	});
});
