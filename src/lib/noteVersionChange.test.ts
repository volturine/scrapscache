import { describe, expect, it } from 'vitest';
import type { SyncNote } from '$lib/syncRecords';
import { describeNoteVersionChange, distinctNoteVersions } from './noteVersionChange';

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
		expect(describeNoteVersionChange(note({ body: '\n- [ ] Milk\nBread' }), undefined)).toEqual({
			added: 0,
			removed: 0,
			summary: 'Milk'
		});
	});

	it('counts added and removed lines and leads with the first added line', () => {
		const previous = note({ body: 'Antifragile\nSapiens' });
		const version = note({ body: 'Antifragile\nDeep Work\n\nSeeing Like a State' });
		expect(describeNoteVersionChange(version, previous)).toEqual({
			added: 2,
			removed: 1,
			summary: 'Deep Work'
		});
	});

	it('names removals and treats duplicate lines as a multiset', () => {
		const previous = note({ body: 'Milk\nMilk\nBread' });
		expect(describeNoteVersionChange(note({ body: 'Milk\nBread' }), previous)).toEqual({
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

	it('prefers a rename over body edits', () => {
		const change = describeNoteVersionChange(note({ title: 'Books', body: 'New' }), note());
		expect(change).toEqual({ added: 1, removed: 1, summary: 'Renamed “Books”' });
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

	it('keeps the newest save of each visible state', () => {
		const entries = [
			entry(5, { body: 'C' }),
			entry(4, { body: 'B' }),
			entry(3, { body: 'B', fieldTimes: { body: 3 } }),
			entry(2, { body: 'A' }),
			entry(1, { body: 'A' })
		];
		expect(distinctNoteVersions(entries, note({ body: 'D' })).map((e) => e.historyId)).toEqual([
			5, 4, 2
		]);
	});

	it('drops the newest state when the live note already shows it', () => {
		const entries = [entry(3, { body: 'B' }), entry(2, { body: 'B' }), entry(1, { body: 'A' })];
		expect(distinctNoteVersions(entries, note({ body: 'B', updatedAt: 9 }))).toEqual([entries[2]]);
	});

	it('treats metadata changes as distinct versions', () => {
		const entries = [entry(2, { pinned: true }), entry(1, {})];
		expect(distinctNoteVersions(entries, note())).toEqual(entries);
	});
});
