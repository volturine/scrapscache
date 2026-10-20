/**
 * Undo for actions that take something out of view, destroy it, or change it with
 * no other feedback: archiving, trashing, deleting a label or board, removing an
 * attachment, moving a Kanban card to another column. Anything the same control
 * visibly reverses (pin, color) is not recorded.
 * The open note keeps its own text history; every step on either side carries a
 * stamp from `undoStamp`, so a shortcut always takes the newest step first.
 * The stack is this tab only. Each step writes a normal edit, so the result syncs.
 */

const LIMIT = 50;
const BAR_MS = 6_000;

export type UndoEntry = {
	/** Shown on the bar. */
	message: string;
	/** Permanent delete of any of these drops the whole step. */
	noteIds: readonly string[];
	undo: () => void;
	redo: () => void;
};

export type Step = UndoEntry & { at: number };

let clock = 0;

/** Orders note-text steps and action steps on one timeline. */
export function undoStamp(): number {
	clock += 1;
	return clock;
}

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
	past = $state<Step[]>([]);
	future = $state<Step[]>([]);
	/** When the newest new step (text or action) was made; older redo steps are void. */
	editedAt = 0;
	/** Latest action, shown with an Undo button for a few seconds. */
	bar = $state<string | null>(null);
	/** True while undo or redo is writing, so that write is not recorded again. */
	private applying = false;
	private timer: ReturnType<typeof setTimeout> | null = null;

	push(entry: UndoEntry): Step | null {
		if (this.applying) return null;
		this.recordEdit();
		const step = { ...entry, at: this.editedAt };
		this.past = [...this.past, step].slice(-LIMIT);
		this.show(entry.message);
		return step;
	}

	/**
	 * Take a step back out, once what it would undo has been undone by hand. Steps are
	 * told apart by their stamp: the state proxies them, so identity would not do.
	 */
	drop(step: Step): void {
		const wasLatest = this.past.at(-1)?.at === step.at;
		this.past = this.past.filter((entry) => entry.at !== step.at);
		this.future = this.future.filter((entry) => entry.at !== step.at);
		if (wasLatest) this.show(null);
	}

	/** A new step anywhere ends what can be redone here. */
	recordEdit(): void {
		this.editedAt = undoStamp();
		if (this.future.length) this.future = [];
	}

	/** Stamp of the step `undo` would take, or 0. */
	newestUndo(): number {
		return this.past.at(-1)?.at ?? 0;
	}

	/** Stamp of the step `redo` would take, or 0. */
	newestRedo(): number {
		return this.future.at(-1)?.at ?? 0;
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
		this.future = [...this.future, { ...entry, at: undoStamp() }];
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
		this.past = [...this.past, { ...entry, at: undoStamp() }].slice(-LIMIT);
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

/** The open note, so a shortcut weighs its text steps against actions. */
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
	// An open note picks the newer of its text step and the latest action itself.
	const fromEditor = editorUndo?.(redo);
	const did = fromEditor ?? (redo ? actionUndo.redo() : actionUndo.undo());
	if (did) event.preventDefault();
}
