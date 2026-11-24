// What a store that saves one kind of record still owes its workspace's database:
// the journal of its changes, the upload marks that failed saves have yet to
// write, and when a failed save is tried again. The board and the canvas library
// stores each save their whole list with the marks of what changed in it, and
// share this.
import { isProfileReleased } from '#lib/db/idb.js';
import { PendingJournal, type Pending, type PendingChange } from '#lib/pendingJournal.js';
import { parseRecordKey } from '#lib/syncRecords.js';
import { Retries, saveRetry } from '#lib/syncRetry.js';

export class UnsavedChanges<T> {
	private readonly retries = new Retries(saveRetry);
	private readonly owed = new Map<string, Set<string>>();

	constructor(
		private readonly journal: PendingJournal<PendingChange<T>>,
		/** What is being saved, for the console. */
		private readonly what: string
	) {}

	/** What a start finds journaled for a workspace: changes whose save never landed. */
	read(pid: string): Pending<PendingChange<T>> {
		return this.journal.read(pid);
	}

	/** The upload marks a save of the workspace carries now: `keys`, and what failed saves owe. */
	begin(pid: string, keys: Iterable<string>): string[] {
		const marks = [...new Set([...(this.owed.get(pid) ?? []), ...keys])];
		this.owed.delete(pid);
		this.retries.trying(pid);
		return marks;
	}

	/**
	 * Journal what the marks name before the save starts, so the change outlives a
	 * stop that comes first. `change` answers what the record with an id is now. What
	 * was journaled is returned, to `settle` once the save has landed.
	 */
	journalFor(
		pid: string,
		marks: Iterable<string>,
		change: (id: string) => PendingChange<T> | undefined
	): Pending<PendingChange<T>> {
		const changes: Pending<PendingChange<T>> = {};
		for (const key of marks) {
			const id = parseRecordKey(key)?.id;
			const now = id === undefined ? undefined : change(id);
			if (id !== undefined && now) changes[id] = now;
		}
		if (!isProfileReleased(pid) && !this.journal.add(pid, changes))
			console.error(`[storage] could not journal unsaved ${this.what}: localStorage write failed`);
		return changes;
	}

	/** These changes are in the database, or lost to something newer there. */
	settle(pid: string, changes: Pending<PendingChange<T>>): void {
		this.journal.settle(pid, changes);
	}

	/** A save of the workspace landed: its next failure starts over. */
	succeeded(pid: string): void {
		this.retries.succeeded(pid);
	}

	/** A save failed: its marks are owed by the next one, and `again` runs after a wait. */
	failed(pid: string, marks: Iterable<string>, again: () => void): void {
		this.owed.set(pid, new Set([...(this.owed.get(pid) ?? []), ...marks]));
		this.retries.failed(pid, again);
	}

	/** No save of the workspace waits to be tried again. The journal keeps what it has. */
	forget(pid: string): void {
		this.owed.delete(pid);
		this.retries.settled(pid);
	}

	/** Nothing unsaved of the workspace is kept at all. */
	clear(pid: string): void {
		this.forget(pid);
		this.journal.clear(pid);
	}
}
