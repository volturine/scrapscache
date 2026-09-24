import { describe, expect, it } from 'vitest';
import type { SyncNote } from '$lib/syncRecords';
import {
	describeNoteVersionChange,
	distinctNoteVersions,
	sameVisibleNote
} from './noteVersionChange';

function note(patch: Partial<SyncNote> = {}): SyncNote {
	return {
		id: 'note',
		title: 'Reading list',
		body: 'Antifragile',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		...patch
	};
}

describe('describeNoteVersionChange', () => {
	it('summarises the earliest loaded version by its first line', () => {
		expect(
			describeNoteVersionChange(note({ body: '\n- [ ] Milk\nBread' }), undefined)
		).toMatchObject({
			added: 0,
			removed: 0,
			summary: 'Milk'
		});
	});

	it('counts added and removed lines and leads with the first added line', () => {
		const previous = note({ body: 'Antifragile\nSapiens' });
		const version = note({ body: 'Antifragile\nDeep Work\n\nSeeing Like a State' });
		expect(describeNoteVersionChange(version, previous)).toMatchObject({
			added: 3,
			removed: 1,
			summary: 'Deep Work'
		});
	});

	it('treats a first body on an empty note as additions only', () => {
		expect(describeNoteVersionChange(note({ body: 'Milk' }), note({ body: '' }))).toMatchObject({
			added: 1,
			removed: 0,
			summary: 'Milk'
		});
	});

	it('describes edits that only add, remove, or move blank lines', () => {
		const spaced = note({ body: 'alpha\n\ngamma' });
		expect(describeNoteVersionChange(note({ body: 'alpha\ngamma' }), spaced)).toMatchObject({
			added: 0,
			removed: 1,
			summary: 'Removed an empty line'
		});
		expect(describeNoteVersionChange(note({ body: 'alpha\n\n\n\ngamma' }), spaced).summary).toBe(
			'Added 2 empty lines'
		);
		expect(describeNoteVersionChange(note({ body: 'alpha\n \ngamma' }), spaced).summary).toBe(
			'Changed line spacing'
		);
		expect(describeNoteVersionChange(note({ body: 'gamma\n\nalpha' }), spaced)).toMatchObject({
			added: 0,
			removed: 0,
			summary: 'Reordered lines'
		});
	});

	it('names removals and treats duplicate lines as a multiset', () => {
		const previous = note({ body: 'Milk\nMilk\nBread' });
		expect(describeNoteVersionChange(note({ body: 'Milk\nBread' }), previous)).toMatchObject({
			added: 0,
			removed: 1,
			summary: 'Removed “Milk”'
		});
	});

	it('reports checklist toggles instead of an add and a remove', () => {
		const previous = note({ body: '[ ] Milk\n[x] Bread' });
		expect(describeNoteVersionChange(note({ body: '[x] Milk\n[x] Bread' }), previous).summary).toBe(
			'Checked “Milk”'
		);
		expect(describeNoteVersionChange(note({ body: '[ ] Milk\n[ ] Bread' }), previous).summary).toBe(
			'Unchecked “Bread”'
		);
	});

	it('prefers a title change over body edits', () => {
		const change = describeNoteVersionChange(note({ title: 'Books', body: 'New' }), note());
		expect(change).toMatchObject({ added: 1, removed: 1, summary: 'Renamed “Books”' });
		expect(describeNoteVersionChange(note({ title: 'Plan' }), note({ title: '' })).summary).toBe(
			'Titled “Plan”'
		);
		expect(describeNoteVersionChange(note({ title: '' }), note()).summary).toBe(
			'Removed the title'
		);
	});

	it('describes metadata-only saves', () => {
		expect(describeNoteVersionChange(note({ pinned: true }), note()).summary).toBe('Pinned');
		expect(describeNoteVersionChange(note({ color: 'blue' }), note()).summary).toBe(
			'Changed colour'
		);
		expect(describeNoteVersionChange(note({ trashed: true }), note()).summary).toBe(
			'Moved to trash'
		);
		expect(describeNoteVersionChange(note(), note()).summary).toBe('No visible changes');
	});
});

describe('distinctNoteVersions', () => {
	const entry = (historyId: number, patch: Partial<SyncNote>) => ({
		historyId,
		note: note({ updatedAt: historyId, ...patch })
	});

	it('keeps the newest save of each run of identical saves', () => {
		const entries = [
			entry(5, { body: 'C' }),
			entry(4, { body: 'B' }),
			entry(3, { body: 'B', fieldTimes: { body: 3 } }),
			entry(2, { body: 'A' }),
			entry(1, { body: 'A' })
		];
		expect(distinctNoteVersions(entries).map((e) => e.historyId)).toEqual([5, 4, 2]);
	});

	it('keeps a lone save such as the initial sync', () => {
		const entries = [entry(1, {})];
		expect(distinctNoteVersions(entries)).toEqual(entries);
	});

	it('treats metadata changes as distinct versions', () => {
		const entries = [entry(2, { pinned: true }), entry(1, {})];
		expect(distinctNoteVersions(entries)).toEqual(entries);
	});
});

describe('sameVisibleNote', () => {
	it('ignores sync bookkeeping but not blank lines', () => {
		expect(sameVisibleNote(note({ updatedAt: 9, fieldTimes: { body: 9 } }), note())).toBe(true);
		expect(sameVisibleNote(note({ body: 'Antifragile\n' }), note())).toBe(false);
	});
});

describe('version diff lines', () => {
	it('lists removed then added lines that hold text', () => {
		const previous = note({ body: 'Antifragile\n\n- [ ] Milk\nSapiens' });
		const version = note({ body: 'Antifragile\n- [x] Milk\nDeep Work  ' });
		expect(describeNoteVersionChange(version, previous).diff).toEqual([
			{ kind: 'removed', text: '- [ ] Milk' },
			{ kind: 'removed', text: 'Sapiens' },
			{ kind: 'added', text: '- [x] Milk' },
			{ kind: 'added', text: 'Deep Work' }
		]);
	});

	it('has no lines for the earliest version or blank-only edits', () => {
		expect(describeNoteVersionChange(note(), undefined).diff).toEqual([]);
		const spaced = note({ body: 'alpha\n\ngamma' });
		expect(describeNoteVersionChange(note({ body: 'alpha\ngamma' }), spaced).diff).toEqual([]);
	});

	it('flags summaries that only restate a diff line', () => {
		const previous = note({ body: 'Milk\n[ ] Bread' });
		expect(
			describeNoteVersionChange(note({ body: 'Milk\n[ ] Bread\nEggs' }), previous)
		).toMatchObject({
			summary: 'Eggs',
			summaryInDiff: true
		});
		expect(describeNoteVersionChange(note({ body: 'Milk' }), previous).summaryInDiff).toBe(true);
		expect(describeNoteVersionChange(note({ body: 'Milk\n[x] Bread' }), previous)).toMatchObject({
			summary: 'Checked “Bread”',
			summaryInDiff: false
		});
	});
});
