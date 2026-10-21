import { describe, expect, it } from 'vitest';
import type { Note } from './types.js';
import {
	activeFilterCount,
	markTokens,
	matchRanges,
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

	it('does not take a task-shaped line inside a code fence for a checklist', () => {
		expect(noteHasType(note({ body: '```\n[ ] example only\n```' }), 'checklist')).toBe(false);
		expect(noteHasType(note({ body: '```\n[ ] example\n```\n- [ ] real' }), 'checklist')).toBe(
			true
		);
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

	it('marks the right characters after a letter that grows when lowercased', () => {
		// İ lowercases to two code units; the x after it is still the x.
		expect(matchSegments('İx', 'x')).toEqual([
			{ text: 'İ', match: false },
			{ text: 'x', match: true }
		]);
		expect(matchRanges('aİbİb', 'b')).toEqual([
			{ start: 2, end: 3 },
			{ start: 4, end: 5 }
		]);
		expect(matchSegments('İstanbul', 'i̇s')).toEqual([
			{ text: 'İs', match: true },
			{ text: 'tanbul', match: false }
		]);
	});

	it('marks the whole letter when the query ends inside its expansion', () => {
		// The store finds İstanbul for "i"; the mark covers the İ it matched within.
		expect(matchSegments('İstanbul', 'i')).toEqual([
			{ text: 'İ', match: true },
			{ text: 'stanbul', match: false }
		]);
		expect(matchSegments('xİ', 'xi')).toEqual([{ text: 'xİ', match: true }]);
	});

	it('folds the whole text as the store does, so a final sigma matches by its context', () => {
		expect(matchSegments('ΟΣ', 'ος')).toEqual([{ text: 'ΟΣ', match: true }]);
		expect(matchSegments('ΟΣ', 'ΟΣ')).toEqual([{ text: 'ΟΣ', match: true }]);
		// The store does not find it for a medial sigma, so nothing is marked.
		expect(matchSegments('ΟΣ', 'οσ')).toEqual([{ text: 'ΟΣ', match: false }]);
	});
});

describe('markTokens', () => {
	it('marks a match that crosses token boundaries in every token it touches', () => {
		const tokens = [{ text: 'echo' }, { text: '"Trip"' }];
		expect(markTokens(tokens, 'o"Tr').map((entry) => entry.segments)).toEqual([
			[
				{ text: 'ech', match: false },
				{ text: 'o', match: true }
			],
			[
				{ text: '"Tr', match: true },
				{ text: 'ip"', match: false }
			]
		]);
	});

	it('marks a whole marked-up run, markers and all', () => {
		const tokens = [{ text: '**' }, { text: 'Tram' }, { text: '**' }];
		expect(markTokens(tokens, '**Tram**').map((entry) => entry.segments)).toEqual([
			[{ text: '**', match: true }],
			[{ text: 'Tram', match: true }],
			[{ text: '**', match: true }]
		]);
	});
});

describe('noteCount', () => {
	it('pluralises', () => {
		expect(noteCount(1)).toBe('1 note');
		expect(noteCount(0)).toBe('0 notes');
		expect(noteCount(12)).toBe('12 notes');
	});
});
