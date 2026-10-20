import { describe, expect, it } from 'vitest';
import type { Note } from './types.js';
import {
	activeFilterCount,
	matchSegments,
	matchesFilters,
	NO_FILTERS,
	noteCount,
	noteHasType
} from './search.js';

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'n',
		title: 'Trip',
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
		...partial
	};
}

describe('noteHasType', () => {
	it('finds a checklist in any checked or unchecked item', () => {
		expect(noteHasType(note({ body: 'plain\n- [x] done' }), 'checklist')).toBe(true);
		expect(noteHasType(note({ body: '[ ] todo' }), 'checklist')).toBe(true);
		expect(noteHasType(note({ body: '- a bullet' }), 'checklist')).toBe(false);
	});

	it('tells photos from drawings', () => {
		const photo = { id: 'p', mime: 'image/png', name: 'p.png', dataUrl: '', createdAt: 1 };
		const drawing = {
			id: 'd',
			mime: 'application/vnd.scrapscache.canvas+json',
			name: 'd',
			dataUrl: '',
			createdAt: 1
		};
		expect(noteHasType(note({ images: [photo] }), 'image')).toBe(true);
		expect(noteHasType(note({ images: [photo] }), 'drawing')).toBe(false);
		expect(noteHasType(note({ images: [drawing] }), 'drawing')).toBe(true);
		expect(noteHasType(note({ images: [drawing] }), 'image')).toBe(false);
	});

	it('finds a link in the body', () => {
		expect(noteHasType(note({ body: 'see https://example.com/x' }), 'link')).toBe(true);
		expect(noteHasType(note({ body: 'no links' }), 'link')).toBe(false);
	});
});

describe('matchesFilters', () => {
	it('passes everything with no filters', () => {
		expect(matchesFilters(note(), NO_FILTERS)).toBe(true);
	});

	it('needs every set filter to hold', () => {
		const n = note({ labels: ['travel'], color: 'blue', body: '[ ] pack' });
		expect(matchesFilters(n, { label: 'travel', color: 'blue', type: 'checklist' })).toBe(true);
		expect(matchesFilters(n, { label: 'work', color: null, type: null })).toBe(false);
		expect(matchesFilters(n, { label: null, color: 'red', type: null })).toBe(false);
		expect(matchesFilters(n, { label: null, color: null, type: 'link' })).toBe(false);
	});

	it('counts the set filters', () => {
		expect(activeFilterCount(NO_FILTERS)).toBe(0);
		expect(activeFilterCount({ label: 'a', color: null, type: 'link' })).toBe(2);
	});
});

describe('matchSegments', () => {
	it('marks every occurrence, whatever the case', () => {
		expect(matchSegments('Tram 28, then tram 15', 'tram')).toEqual([
			{ text: 'Tram', match: true },
			{ text: ' 28, then ', match: false },
			{ text: 'tram', match: true },
			{ text: ' 15', match: false }
		]);
	});

	it('leaves text whole for an empty query, and gives nothing for empty text', () => {
		expect(matchSegments('plain', '  ')).toEqual([{ text: 'plain', match: false }]);
		expect(matchSegments('', 'x')).toEqual([]);
	});

	it('leaves text whole when nothing matches', () => {
		expect(matchSegments('plain', 'zzz')).toEqual([{ text: 'plain', match: false }]);
	});
});

describe('noteCount', () => {
	it('pluralises', () => {
		expect(noteCount(1)).toBe('1 note');
		expect(noteCount(0)).toBe('0 notes');
		expect(noteCount(12)).toBe('12 notes');
	});
});
