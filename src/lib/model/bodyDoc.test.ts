import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BodyAuthor, isReadableBodyDoc, mergeBodies, replaceBodySnapshot } from './bodyDoc';

describe('note body documents', () => {
	it('keeps edits on a stored root text document in their existing history', () => {
		const doc = new Y.Doc();
		doc.getText('body').insert(0, 'shared');
		const base = {
			body: 'shared',
			bodyDoc: btoa(String.fromCharCode(...Y.encodeStateAsUpdate(doc)))
		};
		const phone = new BodyAuthor().edit('n', base, 'shared phone');
		const laptop = new BodyAuthor().edit('n', base, 'laptop shared');
		const merged = mergeBodies(phone, laptop);
		expect(merged.body).toBe('laptop shared phone');
		expect(mergeBodies(laptop, phone)).toEqual(merged);
		expect(isReadableBodyDoc(merged.bodyDoc, merged.body)).toBe(true);
	});

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

	it('keeps a readable document authoritative when its plain projection is stale', () => {
		const current = new BodyAuthor().edit('n', { body: '' }, 'first');
		const stale = { body: 'rewritten elsewhere', bodyDoc: current.bodyDoc };
		const forward = mergeBodies(stale, current);
		const backward = mergeBodies(current, stale);
		const replayed = mergeBodies(forward, stale);

		expect(forward.body).toBe('first');
		expect(backward).toEqual(forward);
		expect(replayed).toEqual(forward);
	});

	it('applies a full snapshot once and lets a later snapshot replace it', () => {
		const base = new BodyAuthor().edit('n', { body: '' }, 'base');
		const write = { time: 30, writer: 'snapshot' };
		const first = replaceBodySnapshot(base, 'ZZZ', write);
		const replayed = replaceBodySnapshot(first, 'ZZZ', write);

		expect(first.body).toBe('ZZZ');
		expect(replayed).toEqual(first);

		const cleared = replaceBodySnapshot(base, '', write);
		const clearedAgain = replaceBodySnapshot(cleared, '', write);
		const restored = replaceBodySnapshot(clearedAgain, 'again', { time: 40, writer: 'snapshot' });
		const oldReplay = replaceBodySnapshot(restored, '', write);

		expect(cleared.body).toBe('');
		expect(clearedAgain).toEqual(cleared);
		expect(restored.body).toBe('again');
		expect(oldReplay).toEqual(restored);
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
