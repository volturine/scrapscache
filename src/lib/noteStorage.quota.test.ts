import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	journalPendingNotes,
	MIRROR_FALLBACK_LIMIT,
	NOTES_MIRROR_KEY,
	readNotesMirror,
	readPendingNotes,
	writeNotesMirror
} from './noteStorage';
import type { Note } from '#lib/types.js';
import { TEST_WORKSPACE } from '../tests/workspace';

function note(id: string, updatedAt: number): Note {
	return {
		id,
		title: `Note ${id}`,
		body: 'x'.repeat(100),
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt,
		reminder: null,
		labels: []
	};
}

describe('notes mirror quota fallback (#83)', () => {
	afterEach(() => {
		localStorage.clear();
		vi.restoreAllMocks();
	});

	it('keeps the most recent notes when the full mirror exceeds the quota', () => {
		const notes = Array.from({ length: 200 }, (_, index) => note(`n${index}`, index));
		writeNotesMirror(notes, TEST_WORKSPACE);
		expect(readNotesMirror(TEST_WORKSPACE)).toHaveLength(200);

		// Simulate a quota that fits only small payloads.
		const real = Storage.prototype.setItem;
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
			if (value.length > 20_000) throw new DOMException('QuotaExceededError');
			real.call(localStorage, key, value);
		});
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		writeNotesMirror(notes, TEST_WORKSPACE);
		logged.mockRestore();

		const mirrored = readNotesMirror(TEST_WORKSPACE).map(({ id }) => id);
		expect(mirrored).toHaveLength(MIRROR_FALLBACK_LIMIT);
		expect(mirrored).toEqual(
			notes
				.slice(-MIRROR_FALLBACK_LIMIT)
				.map(({ id }) => id)
				.reverse()
		);
	});

	it('leaves the previous mirror in place when even the fallback exceeds the quota', () => {
		writeNotesMirror([note('old', 1)], TEST_WORKSPACE);
		expect(readNotesMirror(TEST_WORKSPACE).map(({ id }) => id)).toEqual(['old']);

		const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('QuotaExceededError');
		});
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		expect(writeNotesMirror([note('new', 2)], TEST_WORKSPACE)).toBe(false);
		setItem.mockRestore();
		logged.mockRestore();

		expect(readNotesMirror(TEST_WORKSPACE).map(({ id }) => id)).toEqual(['old']);
		expect(localStorage.getItem(`${NOTES_MIRROR_KEY}:${TEST_WORKSPACE}`)).toContain('old');
	});

	it('gives up the fast-boot mirror before an unsaved edit', () => {
		writeNotesMirror(
			Array.from({ length: 50 }, (_, index) => note(`n${index}`, index)),
			TEST_WORKSPACE
		);
		// A quota the mirror has filled: nothing more fits beside it.
		const real = Storage.prototype.setItem;
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
			if (localStorage.getItem(`${NOTES_MIRROR_KEY}:${TEST_WORKSPACE}`) !== null)
				throw new DOMException('QuotaExceededError');
			real.call(localStorage, key, value);
		});
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		expect(journalPendingNotes([note('edited', 99)], TEST_WORKSPACE)).toBe(true);
		logged.mockRestore();

		expect(Object.keys(readPendingNotes(TEST_WORKSPACE))).toEqual(['edited']);
		expect(readNotesMirror(TEST_WORKSPACE).map(({ id }) => id)).toEqual(['edited']);
	});
});
