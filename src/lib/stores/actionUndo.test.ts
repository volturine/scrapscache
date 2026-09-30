import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionUndo, runUndoChord, shortcutOwnsUndo, undoChord } from './actionUndo.svelte';

afterEach(() => {
	actionUndo.clear();
});

function key(target: EventTarget, init: KeyboardEventInit, prevented = false) {
	return {
		key: init.key ?? '',
		metaKey: init.metaKey ?? false,
		ctrlKey: init.ctrlKey ?? false,
		altKey: init.altKey ?? false,
		shiftKey: init.shiftKey ?? false,
		defaultPrevented: prevented,
		target,
		preventDefault() {
			this.defaultPrevented = true;
		}
	};
}

describe('actionUndo', () => {
	it('undoes and redoes the latest step', () => {
		let value = 0;
		actionUndo.push({
			message: 'Moved to trash',
			noteIds: ['n'],
			undo: () => {
				value = 0;
			},
			redo: () => {
				value = 1;
			}
		});
		value = 1;

		expect(actionUndo.bar).toBe('Moved to trash');
		expect(actionUndo.undo()).toBe(true);
		expect(value).toBe(0);
		expect(actionUndo.bar).toBeNull();
		expect(actionUndo.redo()).toBe(true);
		expect(value).toBe(1);
		expect(actionUndo.bar).toBe('Moved to trash');
	});

	it('does not record a write made while undoing', () => {
		actionUndo.push({
			message: 'Note archived',
			noteIds: [],
			undo: () => {
				actionUndo.push({ message: 'nested', noteIds: [], undo() {}, redo() {} });
			},
			redo() {}
		});

		actionUndo.undo();

		expect(actionUndo.past).toHaveLength(0);
		expect(actionUndo.future).toHaveLength(1);
		expect(actionUndo.bar).toBeNull();
	});

	it('groups a transaction into one step, undone last-first', () => {
		const order: string[] = [];
		actionUndo.transact(null, () => {
			actionUndo.push({
				message: 'a',
				noteIds: ['1'],
				undo: () => order.push('undo-a'),
				redo: () => order.push('redo-a')
			});
			actionUndo.push({
				message: 'b',
				noteIds: ['2'],
				undo: () => order.push('undo-b'),
				redo: () => order.push('redo-b')
			});
		});

		expect(actionUndo.bar).toBeNull();
		expect(actionUndo.past).toHaveLength(1);
		actionUndo.undo();
		expect(order).toEqual(['undo-b', 'undo-a']);
		actionUndo.redo();
		expect(order).toEqual(['undo-b', 'undo-a', 'redo-a', 'redo-b']);
	});

	it('drops a step that mentions a permanently deleted note', () => {
		actionUndo.push({ message: 'Note archived', noteIds: ['older'], undo() {}, redo() {} });
		actionUndo.push({ message: 'Moved to trash', noteIds: ['gone'], undo() {}, redo() {} });

		actionUndo.dropNotes(['gone']);

		expect(actionUndo.past.map((entry) => entry.noteIds)).toEqual([['older']]);
		expect(actionUndo.bar).toBeNull();
	});

	it('hides the bar when the latest action has no message', () => {
		actionUndo.push({ message: 'Note archived', noteIds: [], undo() {}, redo() {} });
		actionUndo.push({ message: null, noteIds: [], undo() {}, redo() {} });

		expect(actionUndo.bar).toBeNull();
		expect(actionUndo.past).toHaveLength(2);
	});

	it('undoes from a shortcut outside a text field', () => {
		const undone = vi.fn();
		actionUndo.push({ message: 'Moved to trash', noteIds: [], undo: undone, redo() {} });

		const event = key(document.body, { key: 'z', ctrlKey: true });
		runUndoChord(event);

		expect(undone).toHaveBeenCalledOnce();
		expect(event.defaultPrevented).toBe(true);
	});

	it('leaves a search field its own undo', () => {
		const undone = vi.fn();
		actionUndo.push({ message: 'Moved to trash', noteIds: [], undo: undone, redo() {} });
		const input = document.createElement('input');

		const event = key(input, { key: 'z', ctrlKey: true });
		runUndoChord(event);

		expect(undone).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it('does not undo twice when the field already handled the chord', () => {
		const undone = vi.fn();
		actionUndo.push({ message: 'Moved to trash', noteIds: [], undo: undone, redo() {} });

		runUndoChord(key(document.body, { key: 'z', metaKey: true }, true));

		expect(undone).not.toHaveBeenCalled();
	});
});

describe('undoChord', () => {
	it('maps Ctrl+Z, Cmd+Shift+Z, and Ctrl+Y', () => {
		expect(undoChord(key(document.body, { key: 'z', ctrlKey: true }))).toBe('undo');
		expect(undoChord(key(document.body, { key: 'z', metaKey: true }))).toBe('undo');
		expect(undoChord(key(document.body, { key: 'Z', ctrlKey: true, shiftKey: true }))).toBe('redo');
		expect(undoChord(key(document.body, { key: 'y', ctrlKey: true }))).toBe('redo');
		expect(undoChord(key(document.body, { key: 'y', metaKey: true }))).toBeNull();
		expect(undoChord(key(document.body, { key: 'z', ctrlKey: true, altKey: true }))).toBeNull();
	});
});

describe('shortcutOwnsUndo', () => {
	it('skips ordinary fields and keeps the note title and body', () => {
		const input = document.createElement('input');
		const title = document.createElement('textarea');
		title.dataset.noteTitle = '';
		const editor = document.createElement('div');
		editor.dataset.bodyEditor = '';
		const child = document.createElement('span');
		editor.append(child);

		expect(shortcutOwnsUndo(input)).toBe(false);
		expect(shortcutOwnsUndo(title)).toBe(true);
		expect(shortcutOwnsUndo(child)).toBe(true);
		expect(shortcutOwnsUndo(document.body)).toBe(true);
	});
});
