/**
 * Undo for actions outside the open note's text (archive, trash, boards, …).
 * Text undo stays in the editor and falls through to this stack when it is empty.
 * The stack is this tab only. Each step writes a normal edit, so the result syncs.
 */

const LIMIT = 50;
const BAR_MS = 6_000;

export type UndoEntry = {
	/** Shown on the bar. Null when the shortcut is enough. */
	message: string | null;
	/** Permanent delete of any of these drops the whole step. */
	noteIds: readonly string[];
	undo: () => void;
	redo: () => void;
};

type ChordEvent = {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	defaultPrevented?: boolean;
	target: EventTarget | null;
	preventDefault(): void;
};

class ActionUndo {
	past = $state<UndoEntry[]>([]);
	future = $state<UndoEntry[]>([]);
	/** Latest action that took a note, label, or board out of view. */
	bar = $state<string | null>(null);
	/** True while undo or redo is writing, so that write is not recorded again. */
	applying = false;
	private hold = 0;
	private group: UndoEntry[] | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;

	holding(): boolean {
		return this.applying || this.hold > 0;
	}

	/** Run a write that should not become its own step (the caller records one). */
	holdFor(run: () => void): void {
		this.hold += 1;
		try {
			run();
		} finally {
			this.hold -= 1;
		}
	}

	push(entry: UndoEntry): void {
		if (this.holding()) return;
		if (this.group) {
			this.group.push(entry);
			return;
		}
		this.past = [...this.past, entry].slice(-LIMIT);
		this.future = [];
		this.show(entry.message);
	}

	/** Several store writes from one gesture become one step. */
	transact(message: string | null, run: () => void): void {
		if (this.holding() || this.group) {
			run();
			return;
		}
		this.group = [];
		let parts: UndoEntry[] = [];
		try {
			run();
		} finally {
			parts = this.group;
			this.group = null;
		}
		if (parts.length === 0) return;
		this.push({
			message,
			noteIds: [...new Set(parts.flatMap((part) => part.noteIds))],
			undo: () => {
				for (const part of [...parts].reverse()) part.undo();
			},
			redo: () => {
				for (const part of parts) part.redo();
			}
		});
	}

	undo(): boolean {
		const entry = this.past.at(-1);
		if (!entry) return false;
		this.past = this.past.slice(0, -1);
		this.applying = true;
		try {
			entry.undo();
		} finally {
			this.applying = false;
		}
		this.future = [...this.future, entry];
		this.show(null);
		return true;
	}

	redo(): boolean {
		const entry = this.future.at(-1);
		if (!entry) return false;
		this.future = this.future.slice(0, -1);
		this.applying = true;
		try {
			entry.redo();
		} finally {
			this.applying = false;
		}
		this.past = [...this.past, entry].slice(-LIMIT);
		this.show(entry.message);
		return true;
	}

	/** A note that was permanently deleted can no longer be put back. */
	dropNotes(ids: readonly string[]): void {
		if (ids.length === 0) return;
		const gone = new Set(ids);
		const keep = (entry: UndoEntry) => !entry.noteIds.some((id) => gone.has(id));
		const latest = this.past.at(-1);
		this.past = this.past.filter(keep);
		this.future = this.future.filter(keep);
		if (this.past.at(-1) !== latest) this.show(null);
	}

	clear(): void {
		this.past = [];
		this.future = [];
		this.group = null;
		this.show(null);
	}

	private show(message: string | null): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.bar = message;
		if (!message) return;
		this.timer = setTimeout(() => {
			this.bar = null;
			this.timer = null;
		}, BAR_MS);
	}
}

export const actionUndo = new ActionUndo();

/** The open note, so a shortcut undoes its text before any action. */
let editorUndo: ((redo: boolean) => boolean | void) | null = null;

export function setEditorUndo(fn: (redo: boolean) => boolean | void): () => void {
	editorUndo = fn;
	return () => {
		if (editorUndo === fn) editorUndo = null;
	};
}

export function undoChord(event: ChordEvent): 'undo' | 'redo' | null {
	if (event.altKey || (!event.metaKey && !event.ctrlKey)) return null;
	const key = event.key.toLowerCase();
	if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
	if (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey) return 'redo';
	return null;
}

/** False while a search box, rename field, or other text control owns the shortcut. */
export function shortcutOwnsUndo(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return true;
	if (target.closest('[data-note-title], [data-body-editor]')) return true;
	return !target.closest(
		'input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]'
	);
}

export function runUndoChord(event: ChordEvent): void {
	const chord = undoChord(event);
	if (!chord || event.defaultPrevented) return;
	if (!shortcutOwnsUndo(event.target)) return;
	const redo = chord === 'redo';
	// An open note drains its own text first and falls through to actions itself.
	const fromEditor = editorUndo?.(redo);
	const did = fromEditor ?? (redo ? actionUndo.redo() : actionUndo.undo());
	if (did) event.preventDefault();
}
