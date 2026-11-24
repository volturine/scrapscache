import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingJournal, type PendingChange } from './pendingJournal';
import { UnsavedChanges } from './unsavedChanges';

type Item = { id: string; name: string };

describe('what a store still owes its workspace', () => {
	let journal: PendingJournal<PendingChange<Item>>;
	let unsaved: UnsavedChanges<Item>;

	beforeEach(() => {
		localStorage.clear();
		vi.useFakeTimers();
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		journal = new PendingJournal('test-unsaved');
		unsaved = new UnsavedChanges(journal, 'test items');
	});

	afterEach(() => {
		unsaved.forget('ws');
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('journals what the marks name, a put or a delete, and nothing else', () => {
		const now: Record<string, PendingChange<Item>> = {
			kept: { kind: 'put', value: { id: 'kept', name: 'Kept' } },
			gone: { kind: 'delete', at: 7 }
		};

		const changes = unsaved.journalFor(
			'ws',
			['board:kept', 'board-tombstone:gone', 'board:unknown', 'profile-meta'],
			(id) => now[id]
		);

		expect(changes).toEqual(now);
		expect(unsaved.read('ws')).toEqual(now);
		unsaved.settle('ws', changes);
		expect(unsaved.read('ws')).toEqual({});
	});

	it('gives the next save the marks a failed one owes, and tries again by itself', () => {
		const again = vi.fn();
		const first = unsaved.begin('ws', ['board:a']);
		unsaved.failed('ws', first, again);

		expect(again).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1_000);
		expect(again).toHaveBeenCalledOnce();
		// The retry, or any save before it, carries the mark that was never written.
		expect(unsaved.begin('ws', ['board:b']).sort()).toEqual(['board:a', 'board:b']);
		expect(unsaved.begin('ws', [])).toEqual([]);
	});

	it('keeps each workspace to itself', () => {
		unsaved.failed('ws', unsaved.begin('ws', ['board:a']), () => undefined);

		expect(unsaved.begin('other', ['board:b'])).toEqual(['board:b']);
	});

	it('tries nothing again once forgotten, and keeps the journal for the next start', () => {
		const again = vi.fn();
		const changes = unsaved.journalFor('ws', ['board:a'], () => ({ kind: 'delete', at: 3 }));
		unsaved.failed('ws', unsaved.begin('ws', ['board:a']), again);

		unsaved.forget('ws');
		vi.advanceTimersByTime(60_000);

		expect(again).not.toHaveBeenCalled();
		expect(unsaved.begin('ws', [])).toEqual([]);
		expect(unsaved.read('ws')).toEqual(changes);
	});

	it('keeps nothing of a workspace that was replaced', () => {
		unsaved.journalFor('ws', ['board:a'], () => ({ kind: 'delete', at: 3 }));
		unsaved.failed('ws', unsaved.begin('ws', ['board:a']), () => undefined);

		unsaved.clear('ws');

		expect(unsaved.read('ws')).toEqual({});
		expect(unsaved.begin('ws', [])).toEqual([]);
	});
});
