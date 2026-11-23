import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPendingJournals, PendingJournal } from './pendingJournal';

describe('the journal of changes whose save has not landed', () => {
	let journal: PendingJournal<{ name: string } | number>;

	beforeEach(() => {
		localStorage.clear();
		journal = new PendingJournal('test-pending');
	});

	afterEach(() => vi.restoreAllMocks());

	it('holds a change from before its save starts until that save has landed', () => {
		expect(journal.add('ws', { a: { name: 'first' }, b: 7 })).toBe(true);
		// What a restarted app reads: nothing of the window is left but this.
		expect(new PendingJournal('test-pending').read('ws')).toEqual({ a: { name: 'first' }, b: 7 });

		journal.settle('ws', { a: { name: 'first' } });
		expect(journal.read('ws')).toEqual({ b: 7 });
		journal.settle('ws', { b: 7 });
		expect(journal.read('ws')).toEqual({});
		expect(localStorage.getItem('test-pending:ws')).toBeNull();
	});

	it('keeps a later change of the same record when an earlier save lands', () => {
		journal.add('ws', { a: { name: 'first' } });
		journal.add('ws', { a: { name: 'second' } });

		journal.settle('ws', { a: { name: 'first' } });

		expect(journal.read('ws')).toEqual({ a: { name: 'second' } });
	});

	it("keeps what another window journaled, and each workspace's own", () => {
		const otherWindow = new PendingJournal<{ name: string } | number>('test-pending');
		journal.add('ws', { a: { name: 'mine' } });
		otherWindow.add('ws', { b: { name: 'theirs' } });
		journal.add('other', { a: { name: 'elsewhere' } });

		expect(journal.read('ws')).toEqual({ a: { name: 'mine' }, b: { name: 'theirs' } });
		expect(journal.read('other')).toEqual({ a: { name: 'elsewhere' } });
	});

	it('makes room when a change does not fit, and says so when it still does not', () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const makeRoom = vi.fn(() => localStorage.removeItem('only-for-speed'));
		const tight = new PendingJournal<number>('test-tight', makeRoom);
		localStorage.setItem('only-for-speed', 'x');
		const setItem = Storage.prototype.setItem;
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
			this: Storage,
			key: string,
			value: string
		) {
			if (this.getItem('only-for-speed') !== null)
				throw new DOMException('full', 'QuotaExceededError');
			setItem.call(this, key, value);
		});

		expect(tight.add('ws', { a: 1 })).toBe(true);
		expect(makeRoom).toHaveBeenCalledWith('ws');
		expect(tight.read('ws')).toEqual({ a: 1 });

		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('full', 'QuotaExceededError');
		});
		expect(tight.add('ws', { b: 2 })).toBe(false);
	});

	it('leaves nothing of a workspace that is gone, in any journal', () => {
		const second = new PendingJournal<number>('test-second');
		journal.add('gone', { a: 1 });
		second.add('gone', { b: 2 });
		journal.add('kept', { c: 3 });

		clearPendingJournals('gone');

		expect(journal.read('gone')).toEqual({});
		expect(second.read('gone')).toEqual({});
		expect(journal.read('kept')).toEqual({ c: 3 });
	});

	it('reads a journal that is not one as empty', () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		localStorage.setItem('test-pending:ws', '[1,2');
		expect(journal.read('ws')).toEqual({});
		localStorage.setItem('test-pending:ws', '[1,2]');
		expect(journal.read('ws')).toEqual({});
	});
});
