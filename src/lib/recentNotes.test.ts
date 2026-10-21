import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearRecentNotes, readRecentNotes, rememberRecentNote } from './recentNotes.js';

afterEach(() => {
	localStorage.clear();
	vi.restoreAllMocks();
});

describe('recent notes', () => {
	it('keeps the last eight opened, newest first, without repeats', () => {
		for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) rememberRecentNote('w1', id);
		rememberRecentNote('w1', 'e');
		expect(readRecentNotes('w1')).toEqual(['e', 'i', 'h', 'g', 'f', 'd', 'c', 'b']);
	});

	it('keeps each workspace to its own list, and forgets one on request', () => {
		rememberRecentNote('w1', 'a');
		rememberRecentNote('w2', 'b');
		expect(readRecentNotes('w1')).toEqual(['a']);
		expect(readRecentNotes('w2')).toEqual(['b']);
		clearRecentNotes('w1');
		expect(readRecentNotes('w1')).toEqual([]);
		expect(readRecentNotes('w2')).toEqual(['b']);
	});

	it('reads a damaged entry as empty and survives a full localStorage', () => {
		localStorage.setItem('scrapscache-recent-notes:w1', '{nope');
		expect(readRecentNotes('w1')).toEqual([]);
		localStorage.setItem('scrapscache-recent-notes:w1', JSON.stringify(['a', 3, null]));
		expect(readRecentNotes('w1')).toEqual(['a']);
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('Full', 'QuotaExceededError');
		});
		expect(() => rememberRecentNote('w1', 'b')).not.toThrow();
	});
});
