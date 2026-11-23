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
		expect(Object.keys(localStorage)).toEqual([]);
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

	// `localStorage` has no transactions across windows: whatever one window does
	// between reading and writing, another may do something in between. Here the
	// other window's change lands inside this window's step, before it writes.
	function whileItWrites(other: () => void): void {
		for (const method of ['setItem', 'removeItem'] as const) {
			const real = Storage.prototype[method] as (this: Storage, ...args: string[]) => void;
			let landed = false;
			vi.spyOn(Storage.prototype, method).mockImplementation(function (
				this: Storage,
				...args: string[]
			) {
				if (!landed) {
					landed = true;
					vi.restoreAllMocks();
					other();
				}
				real.apply(this, args);
			});
		}
	}

	it('keeps what another window journals while this one takes a saved change out', () => {
		const otherWindow = new PendingJournal<{ name: string } | number>('test-pending');
		journal.add('ws', { a: { name: 'mine' } });

		whileItWrites(() => otherWindow.add('ws', { b: { name: 'theirs' } }));
		journal.settle('ws', { a: { name: 'mine' } });

		expect(new PendingJournal('test-pending').read('ws')).toEqual({ b: { name: 'theirs' } });
	});

	it('keeps what another window journals while this one journals', () => {
		const otherWindow = new PendingJournal<{ name: string } | number>('test-pending');

		whileItWrites(() => otherWindow.add('ws', { b: { name: 'theirs' } }));
		journal.add('ws', { a: { name: 'mine' } });

		expect(new PendingJournal('test-pending').read('ws')).toEqual({
			a: { name: 'mine' },
			b: { name: 'theirs' }
		});
	});

	it("keeps another window's change of the same record when this one's save lands", () => {
		const otherWindow = new PendingJournal<{ name: string } | number>('test-pending');
		journal.add('ws', { a: { name: 'mine' } });

		whileItWrites(() => otherWindow.add('ws', { a: { name: 'theirs' } }));
		journal.settle('ws', { a: { name: 'mine' } });

		expect(new PendingJournal('test-pending').read('ws')).toEqual({ a: { name: 'theirs' } });
	});

	it('keeps both when two windows changed a record and neither save landed', () => {
		const otherWindow = new PendingJournal<{ name: string } | number>('test-pending');
		journal.add('ws', { a: { name: 'first' } });
		otherWindow.add('ws', { a: { name: 'second' } });

		// A start replays the later one, and takes out only what it saved.
		const restarted = new PendingJournal<{ name: string } | number>('test-pending');
		expect(restarted.read('ws')).toEqual({ a: { name: 'second' } });
		restarted.settle('ws', { a: { name: 'second' } });

		expect(restarted.read('ws')).toEqual({ a: { name: 'first' } });
		restarted.settle('ws', { a: { name: 'first' } });
		expect(Object.keys(localStorage)).toEqual([]);
	});

	it('leaves one entry for a record this window changed many times', () => {
		for (let edit = 0; edit < 20; edit++) journal.add('ws', { a: { name: `edit ${edit}` } });

		expect(Object.keys(localStorage)).toHaveLength(1);
		expect(new PendingJournal('test-pending').read('ws')).toEqual({ a: { name: 'edit 19' } });
	});

	it('takes out an earlier change its window was stopped before taking out', () => {
		const stopped = new PendingJournal<{ name: string } | number>('test-pending');
		stopped.add('ws', { a: { name: 'earlier' } });
		// The stop comes after the later change is stored and before the earlier one goes.
		vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => undefined);
		stopped.add('ws', { a: { name: 'later' } });
		expect(Object.keys(localStorage)).toHaveLength(2);

		const restarted = new PendingJournal<{ name: string } | number>('test-pending');
		expect(restarted.read('ws')).toEqual({ a: { name: 'later' } });
		restarted.settle('ws', { a: { name: 'later' } });

		expect(restarted.read('ws')).toEqual({});
		expect(Object.keys(localStorage)).toEqual([]);
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

	it('reads past an entry that is not one', () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		journal.add('ws', { a: 1 });
		localStorage.setItem('test-pending:ws:0000000000:window', '[1,2');
		localStorage.setItem('test-pending:ws:0000000001:window', '[1,2]');
		localStorage.setItem('test-pending:ws', '{"b":2}');
		expect(journal.read('ws')).toEqual({ a: 1 });
	});
});
