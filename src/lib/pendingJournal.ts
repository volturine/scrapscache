// Changes whose save to a workspace's database has not landed yet. Each is written
// here in one synchronous step before its save starts, and taken out once that
// save has landed. A start replays what is left through the ordinary save, so a
// change outlives the app being stopped before its save finished. Every kind of
// record has one: notes, labels, boards and the canvas library.
//
// A journal is shared by every window of the workspace, and `localStorage` has no
// transactions across windows. So a change is an entry of its own, under a key no
// other change ever has: it is written once, never rewritten, and taken out by that
// key. No window reads the journal in order to write it, and none can write over
// what another journaled.

import { uid } from '#lib/model/uid.js';

/** Unsaved changes of one kind, by record id. */
export type Pending<T> = Record<string, T>;

/** What a change did to a record: put it, as it is now, or deleted it, at that time. */
export type PendingChange<T> = { kind: 'put'; value: T } | { kind: 'delete'; at: number };

/** An entry this window knows of: one it journaled, or one a start found and replays. */
type Held = {
	/** The change, as text: an entry is taken out for a save of exactly this. */
	json: string;
	/** Journaled by this window, so a later change of the record here stands for it. */
	mine: boolean;
};

type Stored<T> = { key: string; order: string; writer: string; id: string; value: T };

const journals: Array<PendingJournal<unknown>> = [];

function markOf(pid: string, id: string): string {
	return `${pid}\u0000${id}`;
}

export class PendingJournal<T> {
	/** This window, in the keys of what it journals. */
	private readonly writer = uid();
	private written = 0;
	/** When the last change was journaled: a clock set back does not put a later one first. */
	private last = 0;
	/** By workspace and record (`mark`), then by the entry's key. */
	private readonly held = new Map<string, Map<string, Held>>();

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

	private prefix(pid: string): string {
		return `${this.name}:${pid}:`;
	}

	/** A key for one change: when it was journaled, then by which window. */
	private newKey(pid: string): string {
		this.last = Math.max(this.last, Date.now());
		const at = this.last.toString(36).padStart(9, '0');
		const nth = (this.written++).toString(36).padStart(6, '0');
		return `${this.prefix(pid)}${at}${nth}:${this.writer}`;
	}

	/** The key of every entry stored for the workspace, with what it says. */
	private keys(pid: string): Array<{ key: string; order: string; writer: string }> {
		const prefix = this.prefix(pid);
		const keys: Array<{ key: string; order: string; writer: string }> = [];
		for (let index = 0; index < localStorage.length; index++) {
			const key = localStorage.key(index);
			if (!key?.startsWith(prefix)) continue;
			const [order, writer, ...rest] = key.slice(prefix.length).split(':');
			if (order && writer && rest.length === 0) keys.push({ key, order, writer });
		}
		return keys;
	}

	/** Every entry stored for the workspace, in the order they were journaled. */
	private stored(pid: string): Array<Stored<T>> {
		const entries: Array<Stored<T>> = [];
		for (const { key, order, writer } of this.keys(pid)) {
			try {
				const entry: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
				if (!entry || typeof entry !== 'object' || !('value' in entry)) continue;
				const { id, value } = entry as { id?: unknown; value: T };
				if (typeof id === 'string') entries.push({ key, order, writer, id, value });
			} catch (err) {
				console.error('[storage] read pending change failed:', this.name, err);
			}
		}
		return entries.sort((left, right) =>
			left.order < right.order ? -1 : left.order > right.order ? 1 : 0
		);
	}

	private hold(pid: string, id: string, key: string, held: Held): void {
		const mark = markOf(pid, id);
		const entries = this.held.get(mark) ?? new Map<string, Held>();
		this.held.set(mark, entries.set(key, held));
	}

	private remove(key: string, pid: string, id: string): void {
		const mark = markOf(pid, id);
		const entries = this.held.get(mark);
		if (entries?.delete(key) && entries.size === 0) this.held.delete(mark);
		try {
			localStorage.removeItem(key);
		} catch {
			/* nothing to take out */
		}
	}

	private put(pid: string, key: string, entry: string): boolean {
		try {
			localStorage.setItem(key, entry);
			return true;
		} catch {
			/* no room: something kept only for speed goes first */
		}
		try {
			this.makeRoom(pid);
			localStorage.setItem(key, entry);
			return true;
		} catch (err) {
			console.error('[storage] write pending change failed:', this.name, err);
			return false;
		}
	}

	/**
	 * What a start finds journaled: the latest change of each record. A record that
	 * two windows changed has an entry from each; the earlier one stays stored and is
	 * found once the later one's save has landed.
	 */
	read(pid: string): Pending<T> {
		if (!pid || typeof localStorage === 'undefined') return {};
		const latest = new Map<string, Stored<T>>();
		const byWriter = new Map<string, Stored<T>>();
		for (const entry of this.stored(pid)) {
			// A window takes its earlier change of a record out once it has journaled a
			// later one. One it was stopped before taking out is taken out here.
			const mark = `${entry.writer}\u0000${entry.id}`;
			const earlier = byWriter.get(mark);
			if (earlier) this.remove(earlier.key, pid, entry.id);
			byWriter.set(mark, entry);
			latest.set(entry.id, entry);
		}
		const found: Pending<T> = {};
		for (const { key, id, value, writer } of latest.values()) {
			found[id] = value;
			this.hold(pid, id, key, { json: JSON.stringify(value), mine: writer === this.writer });
		}
		return found;
	}

	/** Journal changes before their saves start. False when they could not be written. */
	add(pid: string, changes: Pending<T>): boolean {
		if (!pid) return false;
		if (typeof localStorage === 'undefined') return Object.keys(changes).length === 0;
		let written = true;
		for (const [id, value] of Object.entries(changes)) {
			const json = JSON.stringify(value);
			const key = this.newKey(pid);
			if (!this.put(pid, key, `{"id":${JSON.stringify(id)},"value":${json}}`)) {
				written = false;
				continue;
			}
			// The later change stands for this window's earlier ones of the record. It is
			// stored before they go, so a stop in between leaves both.
			for (const [earlier, held] of this.held.get(markOf(pid, id)) ?? [])
				if (held.mine) this.remove(earlier, pid, id);
			this.hold(pid, id, key, { json, mine: true });
		}
		return written;
	}

	/**
	 * Take out the entries whose saves landed: those this window journaled or
	 * replays, and only while they hold exactly what was saved. A later change, from
	 * this window or another, has an entry of its own and keeps it until its own
	 * save lands.
	 */
	settle(pid: string, landed: Pending<T>): void {
		if (!pid) return;
		for (const [id, saved] of Object.entries(landed)) {
			const json = JSON.stringify(saved);
			for (const [key, held] of this.held.get(markOf(pid, id)) ?? [])
				if (held.json === json) this.remove(key, pid, id);
		}
	}

	clear(pid: string): void {
		for (const mark of this.held.keys())
			if (mark.startsWith(markOf(pid, ''))) this.held.delete(mark);
		if (!pid || typeof localStorage === 'undefined') return;
		try {
			for (const { key } of this.keys(pid)) localStorage.removeItem(key);
		} catch {
			/* nothing to clear */
		}
	}
}

/** Nothing unsaved of a workspace that is gone stays behind. */
export function clearPendingJournals(pid: string): void {
	for (const journal of journals) journal.clear(pid);
}
