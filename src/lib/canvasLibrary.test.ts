import { describe, expect, it } from 'vitest';
import {
	diffCanvasLibrary,
	libraryItemsFor,
	mergeCanvasLibrary,
	type CanvasLibraryEntry,
	type CanvasLibraryItem
} from './canvasLibrary';

function item(id: string, created = 1, name?: string): CanvasLibraryItem {
	return { id, status: 'unpublished', created, elements: [], ...(name ? { name } : {}) };
}

function entry(id: string, updatedAt: number, name?: string): CanvasLibraryEntry {
	return { id, updatedAt, item: item(id, 1, name) };
}

describe('canvas shape library', () => {
	it('keeps the newest version of each item', () => {
		const merged = mergeCanvasLibrary(
			[entry('star', 5, 'old'), entry('box', 1)],
			[entry('star', 9, 'new')],
			{}
		);
		expect(merged.find((candidate) => candidate.id === 'star')?.item.name).toBe('new');
		expect(merged.map((candidate) => candidate.id).sort()).toEqual(['box', 'star']);
	});

	it('settles same-time versions the same way on every device', () => {
		const left = entry('star', 5, 'a');
		const right = entry('star', 5, 'b');
		expect(mergeCanvasLibrary([left], [right], {})).toEqual(
			mergeCanvasLibrary([right], [left], {})
		);
	});

	it('drops an item a later delete saw, and keeps one saved after the delete', () => {
		expect(mergeCanvasLibrary([entry('star', 5)], [], { star: 6 })).toEqual([]);
		expect(mergeCanvasLibrary([entry('star', 7)], [], { star: 6 })).toHaveLength(1);
	});

	it('ignores malformed entries', () => {
		const malformed = { id: 'bad', updatedAt: 1, item: { id: 'other', created: 1, elements: [] } };
		expect(mergeCanvasLibrary([], [malformed as CanvasLibraryEntry], {})).toEqual([]);
	});

	it('lists items newest first', () => {
		const items = libraryItemsFor([
			{ id: 'old', updatedAt: 1, item: item('old', 1) },
			{ id: 'new', updatedAt: 1, item: item('new', 2) }
		]);
		expect(items.map((candidate) => candidate.id)).toEqual(['new', 'old']);
	});

	it('reports only what the editor changed since it last reported', () => {
		const shown = [item('kept'), item('renamed', 1, 'before'), item('removed')];
		const next = [item('added'), item('kept'), item('renamed', 1, 'after')];
		const change = diffCanvasLibrary(shown, next);
		expect(change.upserts.map((candidate) => candidate.id).sort()).toEqual(['added', 'renamed']);
		expect(change.removals).toEqual(['removed']);
	});
});
