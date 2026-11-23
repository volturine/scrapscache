// Changes whose save to a workspace's database has not landed yet. Each is written
// here in one synchronous step before its save starts, and taken out once that
// save has landed. A start replays what is left through the ordinary save, so a
// change outlives the app being stopped before its save finished. Every kind of
// record has one: notes, labels, boards and the canvas library.
//
// A journal is shared by every window of the workspace: it is read, changed and
// written back, so what another window journaled stays, and an entry leaves only
// while it still holds what was saved.

/** Unsaved changes of one kind, by record id. */
export type Pending<T> = Record<string, T>;

/** What a change did to a record: put it, as it is now, or deleted it, at that time. */
export type PendingChange<T> = { kind: 'put'; value: T } | { kind: 'delete'; at: number };

const journals: Array<PendingJournal<unknown>> = [];

export class PendingJournal<T> {
	/**
	 * `makeRoom` frees `localStorage` when a change does not fit: unsaved changes
	 * come before anything kept there only for speed.
	 */
	constructor(
		private readonly name: string,
		private readonly makeRoom: (pid: string) => void = () => undefined
	) {
		journals.push(this as PendingJournal<unknown>);
	}

	private key(pid: string): string {
		return `${this.name}:${pid}`;
	}

	/** The journal as stored: one entry per record id. */
	read(pid: string): Pending<T> {
		if (!pid || typeof localStorage === 'undefined') return {};
		try {
			const parsed: unknown = JSON.parse(localStorage.getItem(this.key(pid)) ?? '{}');
			return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
				? (parsed as Pending<T>)
				: {};
		} catch (err) {
			console.error('[storage] read pending changes failed:', this.name, err);
			return {};
		}
	}

	private write(pid: string, entries: Pending<T>): boolean {
		if (typeof localStorage === 'undefined') return false;
		try {
			if (Object.keys(entries).length) localStorage.setItem(this.key(pid), JSON.stringify(entries));
			else localStorage.removeItem(this.key(pid));
			return true;
		} catch (err) {
			console.error('[storage] write pending changes failed:', this.name, err);
			return false;
		}
	}

	/** Journal changes before their saves start. False when they could not be written. */
	add(pid: string, changes: Pending<T>): boolean {
		if (!pid) return false;
		if (Object.keys(changes).length === 0) return true;
		const entries = { ...this.read(pid), ...changes };
		if (this.write(pid, entries)) return true;
		try {
			this.makeRoom(pid);
		} catch {
			return false;
		}
		return this.write(pid, entries);
	}

	/**
	 * Drop the entries whose saves landed. An entry only goes while it still holds
	 * what was saved: a later change, from this window or another, journaled its
	 * own and keeps it until its own save lands.
	 */
	settle(pid: string, landed: Pending<T>): void {
		if (!pid) return;
		const entries = this.read(pid);
		let changed = false;
		for (const [id, saved] of Object.entries(landed)) {
			if (id in entries && JSON.stringify(entries[id]) === JSON.stringify(saved)) {
				delete entries[id];
				changed = true;
			}
		}
		if (changed) this.write(pid, entries);
	}

	clear(pid: string): void {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.removeItem(this.key(pid));
		} catch {
			/* nothing to clear */
		}
	}
}

/** Nothing unsaved of a workspace that is gone stays behind. */
export function clearPendingJournals(pid: string): void {
	for (const journal of journals) journal.clear(pid);
}
