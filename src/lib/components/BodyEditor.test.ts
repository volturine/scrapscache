import { fireEvent, render } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BodyEditor from './BodyEditor.svelte';
import { uiStore } from '$lib/stores/ui.svelte';

function textNode(element: Node): Node {
	return element instanceof Element ? (element.firstChild ?? element) : element;
}

function select(start: Node, startOffset: number, end: Node = start, endOffset = startOffset) {
	const range = document.createRange();
	range.setStart(textNode(start), startOffset);
	range.setEnd(textNode(end), endOffset);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
}

function lineTexts(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-line-text]')].map((line) => line.textContent ?? '');
}

function rawCaretText(line: Element): string {
	const selection = window.getSelection();
	if (!selection?.anchorNode) return '';
	const range = document.createRange();
	range.selectNodeContents(line);
	range.setEnd(selection.anchorNode, selection.anchorOffset);
	return range.toString();
}

function caretAt(container: HTMLElement, line: number, offset: number) {
	const text = container.querySelector(`[data-editor-line="${line}"] [data-line-text]`);
	if (!text) throw new Error(`Expected editor line ${line}`);
	const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
	let remaining = offset;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const length = node.textContent?.length ?? 0;
		if (remaining <= length) return select(node, remaining);
		remaining -= length;
	}
	throw new Error(`Offset ${offset} is outside editor line ${line}`);
}

function selectedEditorText(): string {
	return window.getSelection()?.toString() ?? '';
}

afterEach(() => {
	uiStore.rawMarkdown = false;
	vi.unstubAllGlobals();
});

describe('BodyEditor native editing', () => {
	it('renders exactly one block row for each saved newline', () => {
		const { container } = render(BodyEditor, {
			props: { body: 'Plain line\n[ ] Task line\nLast line' }
		});
		const rows = [...container.querySelectorAll('[data-editor-line]')];

		expect(rows).toHaveLength(3);
		expect(lineTexts(container)).toEqual(['Plain line', 'Task line', 'Last line']);
		for (const row of rows) {
			expect(row.querySelector(':scope > [data-line-text]')).not.toBeNull();
			expect(row.querySelector(':scope > div')).toBeNull();
		}
	});

	it('toggles a checklist item without moving focus from the editor', async () => {
		const { container } = render(BodyEditor, { props: { body: '[ ] Task' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const toggle = container.querySelector('[data-checklist-toggle]') as HTMLButtonElement;
		editor.focus();

		const pointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
		toggle.dispatchEvent(pointerDown);
		await fireEvent.click(toggle);

		expect(pointerDown.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(editor);
		expect(toggle.getAttribute('aria-pressed')).toBe('true');
	});

	it('does not focus a task when a checkbox touch ends over its label', () => {
		const onFocusTask = vi.fn();
		const { container } = render(BodyEditor, {
			props: { body: '[ ] Task', onFocusTask }
		});
		const toggle = container.querySelector('[data-checklist-toggle]') as HTMLButtonElement;
		const label = container.querySelector('[data-line-text]') as HTMLElement;
		const pointer = (type: string, target: Element) => {
			const event = new MouseEvent(type, { bubbles: true, cancelable: true });
			Object.defineProperties(event, {
				pointerId: { value: 7 },
				pointerType: { value: 'touch' }
			});
			target.dispatchEvent(event);
		};

		pointer('pointerdown', toggle);
		pointer('pointerup', label);
		label.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

		expect(onFocusTask).not.toHaveBeenCalled();
		expect(container.querySelector('[data-focus-group]')).toBeNull();
	});

	it('replaces an empty root task with a focused plain-text line', async () => {
		const { container } = render(BodyEditor, { props: { body: '[ ] \nafter' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const emptyTask = container.querySelector('[data-line-text]') as HTMLElement;
		select(emptyTask, 0);

		await fireEvent.keyDown(editor, { key: 'Enter' });

		expect(container.querySelector('[data-checklist-toggle]')).toBeNull();
		expect(lineTexts(container)).toEqual(['', 'after']);
		expect(document.activeElement).toBe(editor);
	});

	it('gives blank lines a full editable line height after Enter', async () => {
		const { container } = render(BodyEditor, { props: { body: 'before\nafter' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const first = container.querySelector('[data-line-text]') as HTMLElement;
		select(first, 'before'.length);

		await fireEvent.keyDown(editor, { key: 'Enter' });

		const blank = container.querySelector('[data-editor-line="1"] [data-line-text]');
		expect(lineTexts(container)).toEqual(['before', '', 'after']);
		expect(blank?.className).toContain('min-h_1lh');
	});

	it('keeps the existing empty sub-task Enter behavior', async () => {
		const { container } = render(BodyEditor, { props: { body: '[ ] parent\n  [ ] ' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const tasks = container.querySelectorAll('[data-line-text]');
		select(tasks[1], 0);

		await fireEvent.keyDown(editor, { key: 'Enter' });

		expect(container.querySelectorAll('[data-checklist-toggle]')).toHaveLength(2);
	});

	it('supports one native selection across multiple task rows and deletes it', async () => {
		const { container } = render(BodyEditor, {
			props: { body: '[ ] First task\n[ ] Second task\n[ ] Keep' }
		});
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const tasks = container.querySelectorAll('[data-line-text]');
		select(tasks[0], 0, tasks[1], 'Second task'.length);

		expect(window.getSelection()?.toString()).toContain('First task');
		expect(window.getSelection()?.toString()).toContain('Second task');
		const setData = vi.fn();
		const copy = new Event('copy', { bubbles: true, cancelable: true });
		Object.defineProperty(copy, 'clipboardData', { value: { setData } });
		editor.dispatchEvent(copy);
		expect(setData).toHaveBeenCalledWith('text/plain', '[ ] First task\n[ ] Second task');

		const beforeInput = new InputEvent('beforeinput', {
			bubbles: true,
			cancelable: true,
			inputType: 'deleteContentBackward'
		});
		editor.dispatchEvent(beforeInput);
		await tick();

		expect(beforeInput.defaultPrevented).toBe(true);
		expect(lineTexts(container)).toEqual(['Keep']);
		expect(container.querySelectorAll('[data-task-row]')).toHaveLength(1);
	});

	it('lets autocorrect replace a word natively and syncs the replaced line', () => {
		const { container } = render(BodyEditor, { props: { body: 'Helo world\nSecond' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const [first, second] = container.querySelectorAll('[data-line-text]');
		select(first, 0, first, 4);

		// iOS commits a pending correction when a tap moves the caret: the event
		// carries no data and the selection still covers the corrected word.
		const beforeInput = new InputEvent('beforeinput', {
			bubbles: true,
			cancelable: true,
			inputType: 'insertReplacementText'
		});
		Object.defineProperty(beforeInput, 'getTargetRanges', {
			value: () => [{ startContainer: first.firstChild }]
		});
		editor.dispatchEvent(beforeInput);
		expect(beforeInput.defaultPrevented).toBe(false);

		first.firstChild!.textContent = 'Hello world';
		select(second, 3);
		editor.dispatchEvent(
			new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' })
		);

		expect(lineTexts(container)).toEqual(['Hello world', 'Second']);
		const range = document.createRange();
		range.selectNodeContents(editor);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
		const setData = vi.fn();
		const copy = new Event('copy', { bubbles: true, cancelable: true });
		Object.defineProperty(copy, 'clipboardData', { value: { setData } });
		editor.dispatchEvent(copy);
		expect(setData).toHaveBeenCalledWith('text/plain', 'Hello world\nSecond');
	});

	it('keeps line order and copy intact across render chunks', async () => {
		const body = Array.from({ length: 130 }, (_, index) => `line ${index}`).join('\n');
		const { container } = render(BodyEditor, { props: { body } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		expect(container.querySelectorAll('[data-editor-chunk]')).toHaveLength(3);

		select(container.querySelector('[data-line-text]') as HTMLElement, 'line 0'.length);
		await fireEvent.keyDown(editor, { key: 'Enter' });

		const rows = [...container.querySelectorAll<HTMLElement>('[data-editor-line]')];
		expect(rows).toHaveLength(131);
		expect(rows.every((row, index) => row.dataset.editorLine === String(index))).toBe(true);
		expect(lineTexts(container).slice(63, 66)).toEqual(['line 62', 'line 63', 'line 64']);

		const range = document.createRange();
		range.setStart(editor, 0);
		range.setEnd(editor, editor.childNodes.length);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
		const setData = vi.fn();
		const copy = new Event('copy', { bubbles: true, cancelable: true });
		Object.defineProperty(copy, 'clipboardData', { value: { setData } });
		editor.dispatchEvent(copy);
		const lines = body.split('\n');
		lines.splice(1, 0, '');
		expect(setData).toHaveBeenCalledWith('text/plain', lines.join('\n'));
	});

	it('keeps the text node when the browser types a trailing NBSP', () => {
		const { container } = render(BodyEditor, { props: { body: 'ab' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const line = container.querySelector('[data-line-text]') as HTMLElement;
		const node = line.firstChild!;
		node.textContent = 'ab ';
		select(line, 3);
		editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
		flushSync();

		expect(line.firstChild).toBe(node);
		expect(window.getSelection()?.focusOffset).toBe(3);
	});

	it('copies the whole body from a select-all anchored on the editor host', () => {
		const { container } = render(BodyEditor, {
			props: { body: '[ ] First task\nplain middle\n[ ] Last task' }
		});
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		// Ctrl/Cmd+A anchors the selection on the host element itself, not a text node.
		const range = document.createRange();
		range.setStart(editor, 0);
		range.setEnd(editor, editor.childNodes.length);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		const setData = vi.fn();
		const copy = new Event('copy', { bubbles: true, cancelable: true });
		Object.defineProperty(copy, 'clipboardData', { value: { setData } });
		editor.dispatchEvent(copy);

		expect(copy.defaultPrevented).toBe(true);
		expect(setData).toHaveBeenCalledWith(
			'text/plain',
			'[ ] First task\nplain middle\n[ ] Last task'
		);
	});

	it('keeps task focus when selected text is deleted from the focused task', async () => {
		const onExitTaskFocus = vi.fn();
		const { container } = render(BodyEditor, {
			props: { body: '[ ] Focused task', focusLine: 0, onExitTaskFocus }
		});
		await tick();
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const task = container.querySelector('[data-line-text]') as HTMLElement;
		select(task, 0, task, 'Focused '.length);

		const beforeInput = new InputEvent('beforeinput', {
			bubbles: true,
			cancelable: true,
			inputType: 'deleteContentBackward'
		});
		editor.dispatchEvent(beforeInput);
		await tick();

		expect(lineTexts(container)).toEqual(['task']);
		expect(container.querySelector('[data-focus-group]')).not.toBeNull();
		expect(document.activeElement).toBe(editor);
		expect(window.getSelection()?.anchorOffset).toBe(0);
		expect(onExitTaskFocus).not.toHaveBeenCalled();
	});

	it('keeps task focus when selected text is deleted from a subtask and can undo the deletion', async () => {
		const onExitTaskFocus = vi.fn();
		const onFocusTask = vi.fn();
		const { container } = render(BodyEditor, {
			props: {
				body: '[ ] Parent\n  [ ] Focused subtask',
				focusLine: 0,
				onFocusTask,
				onExitTaskFocus
			}
		});
		await tick();
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const subtask = container.querySelectorAll('[data-line-text]')[1];
		select(subtask, 'Focused '.length, subtask, 'Focused sub'.length);

		editor.dispatchEvent(
			new InputEvent('beforeinput', {
				bubbles: true,
				cancelable: true,
				inputType: 'deleteContentBackward'
			})
		);
		await tick();

		expect(lineTexts(container)).toEqual(['Parent', 'Focused task']);
		expect(container.querySelector('[data-focus-group]')).not.toBeNull();
		expect(document.activeElement).toBe(editor);
		expect(onFocusTask).not.toHaveBeenCalled();
		expect(onExitTaskFocus).not.toHaveBeenCalled();

		await fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
		await tick();

		expect(lineTexts(container)).toEqual(['Parent', 'Focused subtask']);
		expect(container.querySelector('[data-focus-group]')).not.toBeNull();
	});

	it('removes a fully selected task row', async () => {
		const { container } = render(BodyEditor, {
			props: { body: '[ ] Remove task\n[ ] Keep task', focusLine: 0 }
		});
		await tick();
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const task = container.querySelector('[data-line-text]') as HTMLElement;
		select(task, 0, task, 'Remove task'.length);

		editor.dispatchEvent(
			new InputEvent('beforeinput', {
				bubbles: true,
				cancelable: true,
				inputType: 'deleteContentBackward'
			})
		);
		await tick();

		expect(lineTexts(container)).toEqual(['Keep task']);
		expect(container.querySelectorAll('[data-task-row]')).toHaveLength(1);
	});

	it('turns an empty first-row task back into a plain line with Backspace', async () => {
		const onExitTaskFocus = vi.fn();
		const { container } = render(BodyEditor, {
			props: { body: '[ ] \nAfter', focusLine: 0, onExitTaskFocus }
		});
		await tick();
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const task = container.querySelector('[data-line-text]') as HTMLElement;
		select(task, 0);

		await fireEvent.keyDown(editor, { key: 'Backspace' });

		expect(lineTexts(container)).toEqual(['', 'After']);
		expect(container.querySelector('[data-editor-line="0"] [data-checklist-toggle]')).toBeNull();
		expect(onExitTaskFocus).toHaveBeenCalledOnce();
	});

	it('undoes and redoes a selected-text deletion while restoring the caret', async () => {
		const { container } = render(BodyEditor, {
			props: { body: '[ ] Focused task', focusLine: 0 }
		});
		await tick();
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const task = container.querySelector('[data-line-text]') as HTMLElement;
		select(task, 0, task, 'Focused '.length);

		editor.dispatchEvent(
			new InputEvent('beforeinput', {
				bubbles: true,
				cancelable: true,
				inputType: 'deleteContentBackward'
			})
		);
		await tick();
		expect(lineTexts(container)).toEqual(['task']);

		await fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
		await tick();
		expect(lineTexts(container)).toEqual(['Focused task']);
		expect(window.getSelection()?.anchorOffset).toBe(0);
		expect(window.getSelection()?.focusOffset).toBe('Focused '.length);

		await fireEvent.keyDown(editor, { key: 'Z', ctrlKey: true, shiftKey: true });
		await tick();
		expect(lineTexts(container)).toEqual(['task']);
		expect(container.querySelector('[data-focus-group]')).not.toBeNull();
	});

	it('cuts the selected task rows from the model', async () => {
		const onExitTaskFocus = vi.fn();
		const { container } = render(BodyEditor, {
			props: {
				body: '[ ] First task\n[ ] Second task\n[ ] Keep',
				focusLine: 0,
				onExitTaskFocus
			}
		});
		await tick();
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const tasks = container.querySelectorAll('[data-line-text]');
		select(tasks[0], 0, tasks[1], 'Second task'.length);

		const setData = vi.fn();
		const cut = new Event('cut', { bubbles: true, cancelable: true });
		Object.defineProperty(cut, 'clipboardData', { value: { setData } });
		editor.dispatchEvent(cut);
		await tick();

		expect(cut.defaultPrevented).toBe(true);
		expect(setData).toHaveBeenCalledWith('text/plain', '[ ] First task\n[ ] Second task');
		expect(lineTexts(container)).toEqual(['Keep']);
		expect(container.querySelectorAll('[data-task-row]')).toHaveLength(1);
		expect(container.querySelector('[data-focus-group]')).not.toBeNull();
		expect(onExitTaskFocus).not.toHaveBeenCalled();
	});

	it('removes a fully selected single row instead of leaving a micro row', async () => {
		const { container } = render(BodyEditor, {
			props: { body: '[ ] Keep before\nplain row to remove\n[ ] Keep after', focusLine: 1 }
		});
		await tick();
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const row = container.querySelector('[data-editor-line="1"] [data-line-text]') as HTMLElement;
		select(row, 0, row, 'plain row to remove'.length);
		const beforeInput = new InputEvent('beforeinput', {
			bubbles: true,
			cancelable: true,
			inputType: 'deleteContentBackward'
		});

		editor.dispatchEvent(beforeInput);
		await tick();

		expect(lineTexts(container)).toEqual(['Keep before', 'Keep after']);
		expect(container.querySelectorAll('[data-editor-line]')).toHaveLength(2);
		expect(container.querySelector('[data-focus-group]')).not.toBeNull();
	});

	it('pastes multiple clipboard lines as structured task rows', async () => {
		const { container } = render(BodyEditor, { props: { body: '[ ] ' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const emptyTask = container.querySelector('[data-line-text]') as HTMLElement;
		select(emptyTask, 0);

		const paste = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(paste, 'clipboardData', {
			value: { getData: () => '[ ] First task\n  [x] Second task' }
		});
		editor.dispatchEvent(paste);
		await tick();

		expect(paste.defaultPrevented).toBe(true);
		expect(lineTexts(container)).toEqual(['First task', 'Second task']);
		expect(container.querySelectorAll('[data-task-row]')).toHaveLength(2);
		expect(
			container.querySelector('[data-editor-line="1"] [data-checklist-toggle]')?.className
		).toContain('checked');
		expect(
			[...editor.childNodes].filter(
				(node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
			)
		).toHaveLength(0);
	});

	it('keeps the caret before the suffix after pasting a multiline list', async () => {
		const { container } = render(BodyEditor, { props: { body: 'suffix' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		select(container.querySelector('[data-line-text]') as HTMLElement, 0);
		const paste = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(paste, 'clipboardData', {
			value: { getData: () => '- first\n  [ ] last' }
		});

		editor.dispatchEvent(paste);
		await tick();

		expect(lineTexts(container)).toEqual(['first', 'lastsuffix']);
		const last = container.querySelector('[data-editor-line="1"] [data-line-text]') as Element;
		expect(rawCaretText(last)).toBe('last');
	});

	it('indents the current text segment with Tab and outdents with Control+Tab', async () => {
		const { container } = render(BodyEditor, { props: { body: 'Hello' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		select(container.querySelector('[data-line-text]') as HTMLElement, 0);

		const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
		editor.dispatchEvent(tab);
		await tick();

		expect(tab.defaultPrevented).toBe(true);
		expect(lineTexts(container)).toEqual(['  Hello']);
		expect(document.activeElement).toBe(editor);

		const controlTab = new KeyboardEvent('keydown', {
			key: 'Tab',
			ctrlKey: true,
			bubbles: true,
			cancelable: true
		});
		editor.dispatchEvent(controlTab);
		await tick();

		expect(controlTab.defaultPrevented).toBe(true);
		expect(lineTexts(container)).toEqual(['Hello']);
	});

	it('outdents a text segment with Shift+Tab', async () => {
		const { container } = render(BodyEditor, { props: { body: '  Hello' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		select(container.querySelector('[data-line-text]') as HTMLElement, 2);

		await fireEvent.keyDown(editor, { key: 'Tab', shiftKey: true });
		await tick();

		expect(lineTexts(container)).toEqual(['Hello']);
	});

	it('indents a selection that spans whole editor rows', async () => {
		const { container } = render(BodyEditor, { props: { body: 'First\nSecond\nThird' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const rows = [...container.querySelectorAll('[data-editor-line]')];
		const range = document.createRange();
		range.setStart(rows[0], 0);
		range.setEnd(rows[1], rows[1].childNodes.length);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		await fireEvent.keyDown(editor, { key: 'Tab' });
		await tick();

		expect(lineTexts(container)).toEqual(['  First', '  Second', 'Third']);
		expect(window.getSelection()?.isCollapsed).toBe(false);
		expect(window.getSelection()?.toString()).toContain('First');
		expect(window.getSelection()?.toString()).toContain('Second');

		await fireEvent.keyDown(editor, { key: 'Tab' });
		await tick();

		expect(lineTexts(container)).toEqual(['    First', '    Second', 'Third']);
	});

	it('indents every selected text segment and keeps the selection', async () => {
		const { container } = render(BodyEditor, { props: { body: 'First\nSecond' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const rows = container.querySelectorAll('[data-line-text]');
		select(rows[0], 0, rows[1], 'Second'.length);

		await fireEvent.keyDown(editor, { key: 'Tab' });
		await tick();

		expect(lineTexts(container)).toEqual(['  First', '  Second']);
		expect(window.getSelection()?.toString()).toContain('First');
		expect(window.getSelection()?.toString()).toContain('Second');
		expect(window.getSelection()?.isCollapsed).toBe(false);

		await fireEvent.keyDown(editor, { key: 'Tab' });
		await tick();

		expect(lineTexts(container)).toEqual(['    First', '    Second']);
		expect(window.getSelection()?.toString()).toContain('First');
		expect(window.getSelection()?.toString()).toContain('Second');
	});

	it('does not indent the previous line when the range starts on a row boundary', async () => {
		const { container } = render(BodyEditor, { props: { body: 'a\nb\nc' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const rows = [...container.querySelectorAll('[data-editor-line]')];
		const texts = [...container.querySelectorAll('[data-line-text]')];
		const range = document.createRange();
		// Shift+ArrowUp from C to the start of B lands here: B's row start is the
		// same DOM point as the end of A, which intersectsNode treats as selecting A.
		range.setStart(rows[1], 0);
		range.setEnd(textNode(texts[2]), 'c'.length);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		await fireEvent.keyDown(editor, { key: 'Tab' });
		await tick();

		expect(lineTexts(container)).toEqual(['a', '  b', '  c']);
	});

	it('does not indent a line whose only selected point is its trailing boundary', async () => {
		const { container } = render(BodyEditor, { props: { body: 'a\nb\nc' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const texts = [...container.querySelectorAll('[data-line-text]')];
		const range = document.createRange();
		range.setStart(textNode(texts[0]), 'a'.length);
		range.setEnd(textNode(texts[2]), 'c'.length);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		await fireEvent.keyDown(editor, { key: 'Tab' });
		await tick();

		expect(lineTexts(container)).toEqual(['a', '  b', '  c']);
	});

	it('indents a reversed keyboard selection of later lines only', async () => {
		const { container } = render(BodyEditor, { props: { body: 'a\nb\nc' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const texts = [...container.querySelectorAll('[data-line-text]')];
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.setBaseAndExtent(textNode(texts[2]), 'c'.length, textNode(texts[1]), 0);

		await fireEvent.keyDown(editor, { key: 'Tab' });
		await tick();

		expect(lineTexts(container)).toEqual(['a', '  b', '  c']);
		expect(window.getSelection()?.toString()).toContain('b');
		expect(window.getSelection()?.toString()).toContain('c');
		expect(window.getSelection()?.toString()).not.toContain('a');
	});

	it('indents a text segment more than four times', async () => {
		const { container } = render(BodyEditor, { props: { body: 'Hello' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		select(container.querySelector('[data-line-text]') as HTMLElement, 0);

		for (let step = 0; step < 5; step++) {
			await fireEvent.keyDown(editor, { key: 'Tab' });
			await tick();
		}

		expect(lineTexts(container)).toEqual([`${'  '.repeat(5)}Hello`]);
	});

	it('keeps a partial selection after indenting a line', async () => {
		const { container } = render(BodyEditor, { props: { body: 'Hello world' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const line = container.querySelector('[data-line-text]') as HTMLElement;
		select(line, 6, line, 11);

		await fireEvent.keyDown(editor, { key: 'Tab' });
		await tick();

		expect(lineTexts(container)).toEqual(['  Hello world']);
		expect(window.getSelection()?.toString()).toBe('world');
	});

	it('nests a checklist line under the previous task with Tab', async () => {
		const { container } = render(BodyEditor, { props: { body: '[ ] parent\n[ ] child' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const rows = container.querySelectorAll('[data-line-text]');
		select(rows[1], 0);

		await fireEvent.keyDown(editor, { key: 'Tab' });
		await tick();

		expect(lineTexts(container)).toEqual(['parent', 'child']);
		expect(
			container.querySelector('[data-editor-line="1"] [data-checklist-toggle]')?.className
		).toContain('scrapscache-checklist__root--indented_true');
		expect(container.querySelector('[data-editor-line="1"]')?.getAttribute('style')).toContain(
			'padding-left'
		);
	});

	it('restores a single copied checklist line as a task', async () => {
		const { container } = render(BodyEditor, { props: { body: '' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		select(container.querySelector('[data-line-text]') as HTMLElement, 0);
		const paste = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(paste, 'clipboardData', {
			value: { getData: () => '[x] Finished task' }
		});

		editor.dispatchEvent(paste);
		await tick();

		expect(lineTexts(container)).toEqual(['Finished task']);
		expect(container.querySelector('[data-checklist-toggle]')?.className).toContain(
			'scrapscache-checklist__root--checked_true'
		);
	});

	it('lets the owner transform an empty-editor paste even without a caret', async () => {
		const lifted: string[] = [];
		const { container } = render(BodyEditor, {
			props: {
				body: '',
				transformPaste: (raw: string) => {
					lifted.push(raw);
					return 'body-from-owner';
				}
			}
		});
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;

		const paste = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '# Heading' } });
		editor.dispatchEvent(paste);
		await tick();

		expect(lifted).toEqual(['# Heading']);
		expect(lineTexts(container)).toEqual(['body-from-owner']);
	});

	it('keeps raw text on the empty editor when the owner declines without a caret', async () => {
		const { container } = render(BodyEditor, {
			props: { body: '', transformPaste: () => null }
		});
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;

		const paste = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'raw\ntext' } });
		editor.dispatchEvent(paste);
		await tick();

		expect(lineTexts(container)).toEqual(['raw', 'text']);
	});
});

describe('BodyEditor markdown bullets', () => {
	it('renders markdown bullet rows with a marker', () => {
		const { container } = render(BodyEditor, { props: { body: '- Milk\n* Bread' } });
		expect(lineTexts(container)).toEqual(['Milk', 'Bread']);
		expect(container.querySelectorAll('[data-bullet-row]')).toHaveLength(2);
		expect(container.querySelectorAll('[data-task-row]')).toHaveLength(0);
	});

	it('continues a bullet list with Enter and exits on an empty bullet', async () => {
		const { container } = render(BodyEditor, { props: { body: '- Milk' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const line = container.querySelector('[data-line-text]') as HTMLElement;
		select(line, 'Milk'.length);

		await fireEvent.keyDown(editor, { key: 'Enter' });
		await tick();

		expect(lineTexts(container)).toEqual(['Milk', '']);
		expect(container.querySelectorAll('[data-bullet-row]')).toHaveLength(2);

		await fireEvent.keyDown(editor, { key: 'Enter' });
		await tick();

		expect(container.querySelectorAll('[data-bullet-row]')).toHaveLength(1);
		expect(lineTexts(container)).toEqual(['Milk', '']);
		expect(document.activeElement).toBe(editor);
	});

	it('splits bullet text across two rows at the same level', async () => {
		const { container } = render(BodyEditor, { props: { body: '- Milk Bread' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const line = container.querySelector('[data-line-text]') as HTMLElement;
		select(line, 'Milk '.length);

		await fireEvent.keyDown(editor, { key: 'Enter' });
		await tick();

		expect(lineTexts(container)).toEqual(['Milk ', 'Bread']);
		expect(container.querySelectorAll('[data-bullet-row]')).toHaveLength(2);
	});

	it('converts a typed dash prefix into a bullet while editing', async () => {
		const { container } = render(BodyEditor, { props: { body: 'Milk' } });
		const line = container.querySelector('[data-line-text]') as HTMLElement;
		select(line, 0);

		line.textContent = '- Milk';
		await fireEvent.input(line);

		expect(lineTexts(container)).toEqual(['Milk']);
		expect(container.querySelectorAll('[data-bullet-row]')).toHaveLength(1);
	});

	it('pastes bullet lines as bullet rows', async () => {
		const { container } = render(BodyEditor, { props: { body: '' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		select(container.querySelector('[data-line-text]') as HTMLElement, 0);

		const paste = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(paste, 'clipboardData', {
			value: { getData: () => '- Milk\n* Bread' }
		});
		editor.dispatchEvent(paste);
		await tick();

		expect(paste.defaultPrevented).toBe(true);
		expect(lineTexts(container)).toEqual(['Milk', 'Bread']);
		expect(container.querySelectorAll('[data-bullet-row]')).toHaveLength(2);
	});

	it('copies a whole bullet line with its markdown marker', async () => {
		const { container } = render(BodyEditor, { props: { body: '- Milk\nplain' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const rows = container.querySelectorAll('[data-line-text]');
		select(rows[0], 0, rows[0], 'Milk'.length);

		const setData = vi.fn();
		const copy = new Event('copy', { bubbles: true, cancelable: true });
		Object.defineProperty(copy, 'clipboardData', { value: { setData } });
		editor.dispatchEvent(copy);

		expect(setData).toHaveBeenCalledWith('text/plain', '- Milk');
	});

	it('indents bullet rows with Tab and outdents with Shift+Tab', async () => {
		const { container } = render(BodyEditor, { props: { body: '- Milk' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		select(container.querySelector('[data-line-text]') as HTMLElement, 0);

		await fireEvent.keyDown(editor, { key: 'Tab' });
		await tick();

		expect(lineTexts(container)).toEqual(['Milk']);
		expect(container.querySelectorAll('[data-bullet-row]')).toHaveLength(1);
		expect(container.querySelector('[data-editor-line="0"]')?.getAttribute('style')).toContain(
			'padding-left'
		);

		await fireEvent.keyDown(editor, { key: 'Tab', shiftKey: true });
		await tick();

		expect(
			container.querySelector('[data-editor-line="0"]')?.getAttribute('style') ?? ''
		).not.toContain('padding-left');
	});

	it('outdents a nested bullet with Backspace while keeping its text', async () => {
		const { container } = render(BodyEditor, { props: { body: '  - Milk' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		select(container.querySelector('[data-line-text]') as HTMLElement, 0);

		await fireEvent.keyDown(editor, { key: 'Backspace' });
		await tick();

		expect(lineTexts(container)).toEqual(['Milk']);
		expect(container.querySelectorAll('[data-bullet-row]')).toHaveLength(1);
		expect(
			container.querySelector('[data-editor-line="0"]')?.getAttribute('style') ?? ''
		).not.toContain('padding-left');
	});

	it('renders inline Markdown without changing the editable raw body', () => {
		const { container } = render(BodyEditor, {
			props: { body: '**bold** *italic* `code` ~~removed~~' }
		});
		const line = container.querySelector('[data-line-text]') as HTMLElement;

		expect(line.textContent).toBe('**bold** *italic* `code` ~~removed~~');
		expect(line.querySelector('.markdown-token-strong')?.textContent).toBe('bold');
		expect(line.querySelector('.markdown-token-emphasis')?.textContent).toBe('italic');
		expect(line.querySelector('.markdown-token-code')?.textContent).toBe('code');
		expect(line.querySelector('.markdown-token-strikethrough')?.textContent).toBe('removed');
		expect(line.querySelectorAll('.markdown-token-marker-hidden')).toHaveLength(8);
	});

	it('renders and edits a Markdown table without changing its source structure', async () => {
		const source = [
			'| Rule name | Matches path | Limit |',
			'| --- | --- | ---: |',
			'| register | `/api/sync/register` | 5 per hour |'
		].join('\n');
		const { container } = render(BodyEditor, { props: { body: source } });
		const table = container.querySelector('[data-markdown-editor-table]');

		expect(table).not.toBeNull();
		expect(table?.querySelectorAll('[data-markdown-table-cell]')).toHaveLength(6);
		expect(table?.querySelectorAll('[data-markdown-table-separator]')).toHaveLength(1);
		expect(table?.querySelector('.markdown-editor-table-header-cell')?.textContent).toBe(
			'Rule name'
		);
		expect(table?.querySelector('.markdown-token-code')?.textContent).toBe('/api/sync/register');
		expect(lineTexts(container)).toEqual(source.split('\n'));

		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const register = table?.querySelectorAll('[data-markdown-table-cell]')[3];
		const registerText = register
			? document.createTreeWalker(register, NodeFilter.SHOW_TEXT).nextNode()
			: null;
		if (!registerText) throw new Error('Expected the first table body cell');
		select(registerText, 'register'.length);
		editor.dispatchEvent(
			new InputEvent('beforeinput', {
				bubbles: true,
				cancelable: true,
				inputType: 'insertText',
				data: 's'
			})
		);
		registerText.textContent = 'registers';
		await fireEvent.input(editor, { inputType: 'insertText', data: 's' });
		await tick();

		expect(lineTexts(container)[2]).toBe('| registers | `/api/sync/register` | 5 per hour |');
	});

	it('renders fenced code in the editor without showing its fences', () => {
		const source = [
			'```sh',
			'# Reads the VAPID pair',
			'wrangler d1 --remote --command "SELECT 1"',
			'```'
		].join('\n');
		const { container } = render(BodyEditor, { props: { body: source } });
		const code = container.querySelector('[data-markdown-editor-code-block]');

		expect(code).not.toBeNull();
		expect(code?.querySelectorAll('[data-markdown-code-fence]')).toHaveLength(2);
		expect(code?.querySelectorAll('[data-markdown-code-line]')).toHaveLength(2);
		expect(code?.querySelector('.markdown-code-token-comment')?.textContent).toBe(
			'# Reads the VAPID pair'
		);
		expect(code?.querySelector('.markdown-code-token-flag')?.textContent).toBe('--remote');
		expect(lineTexts(container)).toEqual(source.split('\n'));
	});

	it('copies the exact Markdown table source without moving focus', async () => {
		const source = [
			'| Rule name | Matches path | Limit |',
			'| --- | --- | ---: |',
			'| register | `/api/sync/register` | 5 per hour |'
		].join('\n');
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
		const { container } = render(BodyEditor, { props: { body: source } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const copy = container.querySelector('[aria-label="Copy table"]') as HTMLButtonElement;
		editor.focus();

		const pointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
		copy.dispatchEvent(pointerDown);
		await fireEvent.click(copy);

		expect(pointerDown.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(editor);
		expect(writeText).toHaveBeenCalledWith(source);
		expect(copy.getAttribute('aria-label')).toBe('Copied table');
	});

	it('copies only the contents of a fenced code block', async () => {
		const source = '```sh\n# comment\nwrangler d1 --remote\n```';
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
		const { container } = render(BodyEditor, { props: { body: source } });
		const copy = container.querySelector('[aria-label="Copy code"]') as HTMLButtonElement;

		await fireEvent.click(copy);

		expect(writeText).toHaveBeenCalledWith('# comment\nwrangler d1 --remote');
		expect(copy.getAttribute('aria-label')).toBe('Copied code');
	});

	it('keeps the last line visible when a fenced code block is not closed', () => {
		const { container } = render(BodyEditor, {
			props: { body: '```text\nnot closed' }
		});
		const code = container.querySelector('[data-markdown-editor-code-block]');

		expect(code?.querySelectorAll('[data-markdown-code-fence]')).toHaveLength(1);
		expect(code?.querySelectorAll('[data-markdown-code-line]')).toHaveLength(1);
		expect(code?.querySelector('[data-markdown-code-line] [data-line-text]')?.textContent).toBe(
			'not closed'
		);
	});

	it('puts only a complete raw Markdown table in its horizontal scroll container', () => {
		uiStore.rawMarkdown = true;
		const source = [
			'| Rule name | Matches path | Limit | Counting by | Action |',
			'| --- | --- | --- | --- | --- |',
			'| register | `/api/sync/register` | 5 per hour | IP | Block, 1 hour |',
			'',
			'Ordinary prose remains outside the table.'
		].join('\n');
		const { container } = render(BodyEditor, { props: { body: source } });
		const editor = container.querySelector('[data-body-editor]');
		const table = editor?.querySelector('[data-markdown-raw-table-container]');

		expect(editor?.classList).toContain('markdown-raw');
		expect(table?.querySelectorAll('[data-editor-line]')).toHaveLength(3);
		expect(table?.querySelector('.markdown-raw-table')).toBeTruthy();
		expect(table?.querySelectorAll('[data-markdown-table-cell]')).toHaveLength(15);
		expect(table?.querySelectorAll('.markdown-token-marker-hidden')).toHaveLength(0);
		expect(
			[...(table?.querySelectorAll('[data-line-text]') ?? [])].map((line) => line.textContent)
		).toEqual(source.split('\n').slice(0, 3));
		expect(table?.contains(editor?.querySelector('[data-editor-line="4"]') ?? null)).toBe(false);
		expect(lineTexts(container)).toEqual(source.split('\n'));
	});

	it('wraps wide editor and raw Markdown blocks in horizontal scroll containers', () => {
		const source = [
			'| Column | Content |',
			'| --- | --- |',
			'| register | `/api/sync/register` |',
			'',
			'```sh',
			'wrangler d1 --remote --command "SELECT 1"',
			'```'
		].join('\n');
		const { container } = render(BodyEditor, { props: { body: source } });
		let scrolls = container.querySelectorAll('.markdown-block-scroll');
		expect(scrolls).toHaveLength(2);
		expect(scrolls[0].classList.contains('markdown-editor-table-scroll')).toBe(true);
		expect(scrolls[1].classList.contains('markdown-editor-code-block')).toBe(true);

		uiStore.rawMarkdown = true;
		const raw = render(BodyEditor, { props: { body: source } });
		scrolls = raw.container.querySelectorAll('.markdown-block-scroll');
		expect(scrolls).toHaveLength(2);
		expect(scrolls[0].querySelector('.markdown-raw-table')).not.toBeNull();
		expect(scrolls[1].classList.contains('markdown-raw-code-block')).toBe(true);
		expect(raw.container.querySelector('[data-markdown-raw-table-container]')).not.toBeNull();
	});

	it('keeps an empty raw line wide enough to show the caret', () => {
		uiStore.rawMarkdown = true;
		const { container } = render(BodyEditor, { props: { body: 'First\n\nThird' } });
		const emptyLine = container.querySelector('[data-editor-line="1"] [data-line-text]');

		expect(emptyLine).not.toBeNull();
		expect(emptyLine?.className).toContain('flex_1_1_0%');
		expect(emptyLine?.textContent).toBe('');
	});

	it('keeps the raw caret position when a closing delimiter activates styling', async () => {
		const { container } = render(BodyEditor, { props: { body: '**bold' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const line = container.querySelector('[data-line-text]') as HTMLElement;
		const source = document.createTreeWalker(line, NodeFilter.SHOW_TEXT).nextNode();
		if (!source) throw new Error('Expected an editable text node');
		select(source, '**bold'.length);
		editor.dispatchEvent(
			new InputEvent('beforeinput', {
				bubbles: true,
				cancelable: true,
				inputType: 'insertText',
				data: '*'
			})
		);
		source.textContent = '**bold**';

		await fireEvent.input(editor, { inputType: 'insertText', data: '*' });
		await tick();

		const styledLine = container.querySelector('[data-line-text]') as HTMLElement;
		expect(styledLine.querySelector('.markdown-token-strong')?.textContent).toBe('bold');
		expect(rawCaretText(styledLine)).toBe('**bold**');
	});
});

describe('BodyEditor task focus chrome', () => {
	it('keeps every line in the same native editing host when a task receives focus', async () => {
		const { container } = render(BodyEditor, {
			props: { body: '[ ] Parent\ncontext between tasks\n  [ ] Child', focusLine: 0 }
		});
		await tick();

		expect(lineTexts(container)).toEqual(['Parent', 'context between tasks', 'Child']);
		expect(container.querySelectorAll('[contenteditable="plaintext-only"]')).toHaveLength(1);
	});

	it('shows Add sub-task on the focused root and drops it when focus leaves', async () => {
		const { container, rerender } = render(BodyEditor, {
			props: { body: '[ ] Avocados\n  [ ] tes\n[ ] Dark chocolate', focusLine: 0 }
		});
		await tick();

		expect(container.querySelector('[data-focus-group]')).not.toBeNull();
		expect(container.querySelector('[data-add-subtask]')).not.toBeNull();
		expect(container.querySelector('[data-add-subtask]')?.closest('[data-editor-line]')).toBe(
			container.querySelector('[data-editor-line="1"]')
		);
		expect(container.querySelector('[data-editor-line="0"]')?.className).toContain(
			'scrapscache-note-body__row--root_true'
		);
		expect(container.querySelector('[data-editor-line="1"]')?.className).toContain(
			'scrapscache-note-body__row--last_true'
		);

		await fireEvent.pointerDown(
			container.querySelector('[data-add-subtask]') as HTMLButtonElement,
			{
				pointerType: 'touch'
			}
		);

		expect(container.querySelectorAll('[data-task-row]')).toHaveLength(4);
		expect(container.querySelector('[data-editor-line="0"]')?.className).not.toContain(
			'scrapscache-note-body__row--last_true'
		);
		expect(container.querySelector('[data-editor-line="2"]')?.className).toContain(
			'scrapscache-note-body__row--last_true'
		);
		expect(
			container
				.querySelector('[data-editor-line="2"] [data-line-text]')
				?.getAttribute('data-placeholder')
		).toBe('Sub-task');
		expect(container.querySelector('[data-add-subtask]')?.closest('[data-editor-line]')).toBe(
			container.querySelector('[data-editor-line="2"]')
		);
		expect(document.activeElement).toBe(container.querySelector('[data-body-editor]'));

		const draft = container.querySelector('[data-editor-line="2"] [data-line-text]') as HTMLElement;
		draft.textContent = 'a';
		await fireEvent.input(draft, { inputType: 'insertText', data: 'a' });
		await tick();
		expect(draft.textContent).toBe('a');

		await rerender({ body: '[ ] Avocados\n  [ ] tes\n[ ] Dark chocolate', focusLine: null });
		await tick();

		expect(container.querySelector('[data-focus-group]')).toBeNull();
		expect(container.querySelector('[data-add-subtask]')).toBeNull();
	});

	it('aligns Add sub-task with subtask indentation and avoids double indenting under existing subtasks', async () => {
		const { container: c1 } = render(BodyEditor, {
			props: { body: '[ ] Avocados\n[ ] Dark chocolate', focusLine: 0 }
		});
		await tick();

		const buttonNoSub = c1.querySelector('[data-add-subtask]') as HTMLButtonElement;
		expect(buttonNoSub).not.toBeNull();
		expect(buttonNoSub.className).toContain('scrapscache-note-body__addSubtask--indented_false');
		expect(buttonNoSub.className).not.toContain('scrapscache-note-body__addSubtask--indented_true');

		const { container: c2 } = render(BodyEditor, {
			props: { body: '[ ] Avocados\n  [ ] Hass\n[ ] Dark chocolate', focusLine: 0 }
		});
		await tick();

		const buttonWithSub = c2.querySelector('[data-add-subtask]') as HTMLButtonElement;
		expect(buttonWithSub).not.toBeNull();
		expect(buttonWithSub.className).toContain('scrapscache-note-body__addSubtask--indented_true');
		expect(buttonWithSub.className).not.toContain(
			'scrapscache-note-body__addSubtask--indented_false'
		);
	});

	it('preserves the subtask draft across mobile pointerdown and blur cycles', async () => {
		const onFocusTask = vi.fn();
		const { container } = render(BodyEditor, {
			props: { body: '[ ] Avocados\n  [ ] Hass\n[ ] Dark chocolate', focusLine: 0, onFocusTask }
		});
		await tick();

		const addBtn = container.querySelector('[data-add-subtask]') as HTMLButtonElement;
		expect(addBtn).not.toBeNull();

		await fireEvent.pointerDown(addBtn, { pointerId: 42, pointerType: 'touch' });
		expect(container.querySelectorAll('[data-task-row]')).toHaveLength(4);

		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		await fireEvent.blur(editor, { relatedTarget: null });

		expect(container.querySelectorAll('[data-task-row]')).toHaveLength(4);

		await fireEvent.pointerUp(editor, { pointerId: 42, pointerType: 'touch' });
	});

	it('ignores editor click when target is the add subtask button', async () => {
		const onFocusTask = vi.fn();
		const { container } = render(BodyEditor, {
			props: { body: '[ ] Avocados\n  [ ] Hass\n[ ] Dark chocolate', focusLine: 0, onFocusTask }
		});
		await tick();

		const addBtn = container.querySelector('[data-add-subtask]') as HTMLButtonElement;
		onFocusTask.mockClear();

		// Clicking the button directly should not trigger container's handleEditorClick row refocus
		await fireEvent.click(addBtn);
		expect(container.querySelectorAll('[data-task-row]')).toHaveLength(4);
	});
});

describe('BodyEditor composition', () => {
	it.each(['Enter', 'Backspace', 'Tab'])('leaves %s to the IME while composing', async (key) => {
		const { container } = render(BodyEditor, { props: { body: 'before\nafter' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		caretAt(container, 1, 0);
		await fireEvent.compositionStart(editor);
		const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

		editor.dispatchEvent(event);
		await tick();

		expect(event.defaultPrevented).toBe(false);
		expect(lineTexts(container)).toEqual(['before', 'after']);
	});

	it('restores the caret when composition activates Markdown styling and undoes in one step', async () => {
		const oninput = vi.fn();
		const { container } = render(BodyEditor, { props: { body: '**bold', oninput } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		const line = container.querySelector('[data-line-text]') as HTMLElement;
		caretAt(container, 0, 6);
		await fireEvent.compositionStart(editor);
		line.firstChild!.textContent = '**bold**';
		select(line.firstChild!, 8);
		await fireEvent.input(editor, { inputType: 'insertCompositionText', isComposing: true });
		expect(oninput).not.toHaveBeenCalled();

		await fireEvent.compositionEnd(editor);
		await tick();

		const styled = container.querySelector('[data-line-text]') as Element;
		expect(styled.querySelector('.markdown-token-strong')?.textContent).toBe('bold');
		expect(rawCaretText(styled)).toBe('**bold**');
		await fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
		await tick();
		expect(lineTexts(container)).toEqual(['**bold']);
	});
});

describe('BodyEditor Markdown table editing', () => {
	it('does not create a table when Enter ends a pipe row inside fenced code', async () => {
		const source = '```text\n| a | b |\n```';
		const { container } = render(BodyEditor, { props: { body: source } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		caretAt(container, 1, '| a | b |'.length);

		await fireEvent.keyDown(editor, { key: 'Enter' });

		expect(lineTexts(container)).toEqual(['```text', '| a | b |', '', '```']);
	});

	it('creates the delimiter and a first row when Enter ends a header row', async () => {
		const { container } = render(BodyEditor, { props: { body: '| Name | Status |' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		editor.focus();
		caretAt(container, 0, '| Name | Status |'.length);

		await fireEvent.keyDown(editor, { key: 'Enter' });
		await tick();

		expect(lineTexts(container)).toEqual([
			'| Name | Status |',
			'| ---- | ------ |',
			'|      |        |'
		]);
		expect(container.querySelector('[data-markdown-editor-table]')).not.toBeNull();
	});

	it('formats the table and moves between cells with Tab, adding a row at the end', async () => {
		const source = ['| a | b |', '|---|:-:|', '| long value | x |'].join('\n');
		const { container } = render(BodyEditor, { props: { body: source } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		editor.focus();
		caretAt(container, 0, 3);

		await fireEvent.keyDown(editor, { key: 'Tab' });
		await tick();
		expect(lineTexts(container)).toEqual([
			'| a          |  b  |',
			'| ---------- | :-: |',
			'| long value |  x  |'
		]);
		expect(selectedEditorText()).toBe('b');

		await fireEvent.keyDown(editor, { key: 'Tab' });
		expect(selectedEditorText()).toBe('long value');
		await fireEvent.keyDown(editor, { key: 'Tab', shiftKey: true });
		expect(selectedEditorText()).toBe('b');

		caretAt(container, 2, lineTexts(container)[2].length - 2);
		await fireEvent.keyDown(editor, { key: 'Tab' });
		await tick();
		expect(lineTexts(container)).toHaveLength(4);
		expect(lineTexts(container)[3]).toBe('|            |     |');
	});

	it('adds a row with Enter and leaves the table from an empty last row', async () => {
		const source = ['| a | b |', '| - | - |', '| 1 | 2 |'].join('\n');
		const { container } = render(BodyEditor, { props: { body: source } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		editor.focus();
		caretAt(container, 2, 3);

		await fireEvent.keyDown(editor, { key: 'Enter' });
		await tick();
		expect(lineTexts(container)).toEqual(['| a | b |', '| - | - |', '| 1 | 2 |', '|   |   |']);

		caretAt(container, 3, 2);
		await fireEvent.keyDown(editor, { key: 'Enter' });
		await tick();
		expect(lineTexts(container)).toEqual(['| a | b |', '| - | - |', '| 1 | 2 |', '']);
		expect(
			container.querySelectorAll('[data-markdown-editor-table] [data-editor-line]')
		).toHaveLength(3);
	});

	it('formats an edited table once focus leaves the editor', async () => {
		const source = ['| a | b |', '|---|---|', '| long value | x |'].join('\n');
		const { container } = render(BodyEditor, { props: { body: source } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		editor.focus();
		caretAt(container, 2, 3);
		editor.dispatchEvent(
			new InputEvent('beforeinput', {
				bubbles: true,
				cancelable: true,
				inputType: 'insertText',
				data: '!'
			})
		);
		await fireEvent.input(editor, { inputType: 'insertText', data: '!' });
		expect(lineTexts(container)[0]).toBe('| a | b |');

		await fireEvent.blur(editor);
		await tick();

		expect(lineTexts(container)).toEqual([
			'| a          | b |',
			'| ---------- | - |',
			'| long value | x |'
		]);
	});

	it('leaves task rows that happen to contain pipes untouched', async () => {
		const { container } = render(BodyEditor, { props: { body: '[ ] | a | b |' } });
		const editor = container.querySelector('[data-body-editor]') as HTMLElement;
		editor.focus();
		caretAt(container, 0, '| a | b |'.length);

		await fireEvent.keyDown(editor, { key: 'Enter' });
		await tick();

		expect(container.querySelector('[data-markdown-editor-table]')).toBeNull();
	});
});
