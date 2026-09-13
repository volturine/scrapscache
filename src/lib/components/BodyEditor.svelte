<script lang="ts">
	import { flushSync, tick } from 'svelte';
	import {
		adjustTextIndent,
		BULLET_RE,
		CHECK_RE,
		formatBulletLine,
		formatCheckLine,
		MAX_LIST_INDENT,
		parseBulletLine,
		parseCheckLine,
		toggleCheckEntries
	} from '$lib/checklistBody';
	import { revealEditorField } from '$lib/editorVisibility';
	import { css } from 'styled-system/css';
	import { checklist, noteBody } from 'styled-system/recipes';
	import { markdownStyles } from '$panda/styles';
	import { markdownTokenClass, parseInlineMarkdown } from '$lib/markdown';
	import { uiStore } from '$lib/stores/ui.svelte';

	const MAX_TASK_INDENT = 1;
	// Rows render in fixed-size chunks that the browser skips while offscreen.
	const CHUNK_SIZE = 64;

	let {
		body = $bindable(''),
		oninput,
		placeholder = '',
		focusLine = null,
		onFocusTask,
		onExitTaskFocus,
		transformPaste
	}: {
		body?: string;
		oninput?: () => void;
		placeholder?: string;
		focusLine?: number | null;
		onFocusTask?: (line: number) => void;
		onExitTaskFocus?: () => void;
		transformPaste?: (text: string) => string | null;
	} = $props();

	type Line = {
		id: number;
		text: string;
		checked: boolean;
		isCheck: boolean;
		isBullet: boolean;
		indent: number;
	};
	type EditorPoint = { line: number; offset: number };
	type EditorRange = { start: EditorPoint; end: EditorPoint; collapsed: boolean };
	type HistoryEntry = {
		body: string;
		startLine: number;
		startOffset: number;
		endLine: number;
		endOffset: number;
	};

	let lineIdCounter = 0;
	function newLine(
		text = '',
		isCheck = false,
		checked = false,
		indent = 0,
		isBullet = false
	): Line {
		const maxIndent = isBullet ? MAX_LIST_INDENT : MAX_TASK_INDENT;
		return {
			id: lineIdCounter++,
			text,
			isCheck,
			isBullet,
			checked,
			indent: Math.max(0, Math.min(maxIndent, indent))
		};
	}

	function parseBodyToLines(raw: string): Line[] {
		if (!raw) return [newLine()];
		return raw.split('\n').map((text) => {
			const check = parseCheckLine(text);
			if (check) return newLine(check.text, true, check.checked, check.indent);
			const bullet = parseBulletLine(text);
			if (bullet) return newLine(bullet.text, false, false, bullet.indent, true);
			return newLine(text, false);
		});
	}

	function serializeLines(rows: Line[]): string {
		return rows
			.map((line) =>
				line.isCheck
					? formatCheckLine(line.indent, line.checked, line.text)
					: line.isBullet
						? formatBulletLine(line.indent, line.text)
						: line.text
			)
			.join('\n');
	}

	let lines = $state<Line[]>(parseBodyToLines(body));
	let container: HTMLDivElement | null = $state(null);
	let draftTaskId = $state<number | null>(null);
	let ignoredFocusLine = $state<number | null>(null);
	let checklistPointerId: number | null = null;
	let subtaskPointerId: number | null = null;
	let composing = false;
	let applyingEdit = false;
	const undoStack: HistoryEntry[] = [];
	const redoStack: HistoryEntry[] = [];

	function syncEditableText(node: HTMLElement, value: string) {
		const apply = (next: string) => {
			// The browser mutates this text node directly. Only reconcile when state
			// actually differs so iOS and Svelte never insert the first character twice.
			// Lines store NBSPs as plain spaces, so an NBSP-only difference is not a
			// divergence; rewriting the node would reset the caret to the line start.
			if (node.textContent?.replaceAll('\u00a0', ' ') !== next) node.textContent = next;
		};
		apply(value);
		return { update: apply };
	}

	let lastSerializedBody = body;
	let syncBodyTimer: ReturnType<typeof setTimeout> | null = null;
	function syncBody(immediate = false) {
		if (immediate) {
			if (syncBodyTimer) {
				clearTimeout(syncBodyTimer);
				syncBodyTimer = null;
			}
			lastSerializedBody = serializeLines(lines.filter((line) => line.id !== draftTaskId));
			body = lastSerializedBody;
			oninput?.();
			return;
		}
		oninput?.();
		if (syncBodyTimer) clearTimeout(syncBodyTimer);
		syncBodyTimer = setTimeout(() => {
			syncBodyTimer = null;
			lastSerializedBody = serializeLines(lines.filter((line) => line.id !== draftTaskId));
			body = lastSerializedBody;
		}, 300);
	}

	export function syncBodyNow() {
		syncBody(true);
	}

	function lineElement(index: number): HTMLElement | null {
		return container?.querySelector(`[data-editor-line="${index}"]`) as HTMLElement | null;
	}

	function textElement(index: number): HTMLElement | null {
		return lineElement(index)?.querySelector('[data-line-text]') as HTMLElement | null;
	}

	function closestLineElement(node: Node | null): HTMLElement | null {
		const element = node instanceof Element ? node : node?.parentElement;
		return element?.closest('[data-editor-line]') as HTMLElement | null;
	}

	function lineIndexOfElement(node: Node | null): number | null {
		const row = closestLineElement(node);
		if (!row || !container?.contains(row)) return null;
		const index = Number(row.dataset.editorLine);
		return Number.isInteger(index) && lines[index] ? index : null;
	}

	function comparePoints(a: EditorPoint, b: EditorPoint): number {
		if (a.line !== b.line) return a.line - b.line;
		return a.offset - b.offset;
	}

	/** Resolve a boundary between the host's or a chunk's children to a line point. */
	function pointBetweenRows(parent: Element, offset: number): EditorPoint | null {
		for (
			let child: ChildNode | null = parent.childNodes[offset] ?? null;
			child;
			child = child.nextSibling
		) {
			if (!(child instanceof Element)) continue;
			const row = child.closest('[data-editor-line]') ?? child.querySelector('[data-editor-line]');
			const line = lineIndexOfElement(row);
			if (line !== null) return { line, offset: 0 };
		}
		const rows = parent.querySelectorAll('[data-editor-line]');
		const line = lineIndexOfElement(rows[rows.length - 1] ?? null) ?? lines.length - 1;
		return { line, offset: lines[line]?.text.length ?? 0 };
	}

	function pointFromDom(node: Node | null, offset: number): EditorPoint | null {
		if (!container || !node) return null;
		if (node === container || (node instanceof HTMLElement && node.dataset.editorChunk === '')) {
			return pointBetweenRows(node as Element, offset);
		}

		const row = closestLineElement(node);
		if (!row || !container.contains(row)) return null;
		const line = lineIndexOfElement(row);
		if (line === null || !lines[line]) return null;
		const text = row.querySelector('[data-line-text]') as HTMLElement | null;
		if (!text) return null;

		if (node === row) {
			const local = offset >= row.childNodes.length ? lines[line].text.length : 0;
			return { line, offset: local };
		}

		let local = 0;
		try {
			if (text === node || text.contains(node)) {
				const range = document.createRange();
				range.selectNodeContents(text);
				range.setEnd(node, offset);
				local = Math.min(lines[line].text.length, range.toString().length);
			} else if (row.contains(node)) {
				const position = text.compareDocumentPosition(node);
				local = position & Node.DOCUMENT_POSITION_FOLLOWING ? lines[line].text.length : 0;
			} else if (node.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING) {
				local = lines[line].text.length;
			}
		} catch {
			local = 0;
		}
		return { line, offset: local };
	}

	function rangeOverlapsLine(nativeRange: Range, row: Element): boolean {
		const text = row.querySelector('[data-line-text]');
		if (!text) return false;
		const lineRange = document.createRange();
		try {
			const content = text.firstChild;
			if (content?.nodeType === Node.TEXT_NODE) lineRange.selectNodeContents(content);
			else if (content) lineRange.selectNodeContents(text);
			else lineRange.selectNode(text);
			// Exclusive overlap against the text node. A Shift+ArrowUp caret parked at
			// the end of the previous line is the same visual start as this row, but
			// Range.intersectsNode still reports that previous line as selected.
			return (
				nativeRange.compareBoundaryPoints(Range.END_TO_START, lineRange) < 0 &&
				nativeRange.compareBoundaryPoints(Range.START_TO_END, lineRange) > 0
			);
		} catch {
			return false;
		}
	}

	function intersectingLines(selection: Selection, startLine: number, endLine: number): number[] {
		if (!container || selection.rangeCount === 0) return [];
		const nativeRange = selection.getRangeAt(0);
		const indices: number[] = [];
		const min = Math.max(0, Math.min(startLine, endLine));
		const max = Math.min(lines.length - 1, Math.max(startLine, endLine));
		for (let index = min; index <= max; index++) {
			const row = lineElement(index);
			if (!row || !rangeOverlapsLine(nativeRange, row)) continue;
			if (lines[index]) indices.push(index);
		}
		return indices;
	}

	function editorRange(): EditorRange | null {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return null;
		if (selection.isCollapsed) {
			const point = pointFromDom(selection.focusNode, selection.focusOffset);
			if (!point) return null;
			return { start: point, end: point, collapsed: true };
		}
		const anchor = pointFromDom(selection.anchorNode, selection.anchorOffset);
		const focus = pointFromDom(selection.focusNode, selection.focusOffset);
		if (!anchor || !focus) return null;
		let [start, end] = comparePoints(anchor, focus) <= 0 ? [anchor, focus] : [focus, anchor];
		const collapsed = start.line === end.line && start.offset === end.offset;
		if (!collapsed) {
			const indices = intersectingLines(selection, start.line, end.line);
			if (indices.length > 0) {
				const first = indices[0];
				const last = indices[indices.length - 1];
				if (start.line !== first) start = { line: first, offset: 0 };
				if (end.line !== last) {
					const offset = lines[last]?.text.length ?? 0;
					end = { line: last, offset };
				}
			} else if (start.line < end.line) {
				if (start.offset >= (lines[start.line]?.text.length ?? 0)) {
					start = { line: start.line + 1, offset: 0 };
				}
				if (end.offset === 0 && end.line > start.line) {
					const line = end.line - 1;
					const offset = lines[line]?.text.length ?? 0;
					end = { line, offset };
				}
			}
		}
		return { start, end, collapsed };
	}

	function historyEntry(range = editorRange()): HistoryEntry {
		const snapshotBody = syncBodyTimer
			? serializeLines(lines.filter((line) => line.id !== draftTaskId))
			: lastSerializedBody;
		const fallbackLine = Math.max(0, lines.length - 1);
		const fallbackOffset = lines[fallbackLine]?.text.length ?? 0;
		return {
			body: snapshotBody,
			startLine: range?.start.line ?? fallbackLine,
			startOffset: range?.start.offset ?? fallbackOffset,
			endLine: range?.end.line ?? fallbackLine,
			endOffset: range?.end.offset ?? fallbackOffset
		};
	}

	let lastTypingTime = 0;
	function recordTypingEdit(range = editorRange()) {
		const now = Date.now();
		if (now - lastTypingTime > 1200) {
			rememberEdit(range);
		}
		lastTypingTime = now;
	}

	function rememberEdit(range = editorRange()) {
		const entry = historyEntry(range);
		if (undoStack.at(-1)?.body !== entry.body) undoStack.push(entry);
		if (undoStack.length > 100) undoStack.shift();
		redoStack.length = 0;
	}

	async function restoreHistory(entry: HistoryEntry) {
		applyingEdit = true;
		try {
			lines = parseBodyToLines(entry.body);
			draftTaskId = null;
			ignoredFocusLine = null;
			syncBody();
			await tick();
			const startLine = Math.min(entry.startLine, lines.length - 1);
			const endLine = Math.min(entry.endLine, lines.length - 1);
			focusTask(endLine);
			selectAt(startLine, entry.startOffset, endLine, entry.endOffset);
		} finally {
			applyingEdit = false;
		}
	}

	function undo() {
		const entry = undoStack.pop();
		if (!entry) return;
		redoStack.push(historyEntry());
		void restoreHistory(entry);
	}

	function redo() {
		const entry = redoStack.pop();
		if (!entry) return;
		undoStack.push(historyEntry());
		void restoreHistory(entry);
	}

	function caretNode(index: number, offset: number): { node: Node; offset: number } | null {
		const resolved = Math.max(0, Math.min(index, lines.length - 1));
		const text = textElement(resolved);
		if (!text) return null;
		const caret = Math.max(0, Math.min(offset, lines[resolved].text.length));
		if (!uiStore.rawMarkdown) {
			let consumed = 0;
			for (let childIndex = 0; childIndex < text.childNodes.length; childIndex++) {
				const child = text.childNodes[childIndex];
				const length = child.textContent?.length ?? 0;
				const hiddenMarker =
					child instanceof Element && child.classList.contains('markdown-token-marker-hidden');
				if (hiddenMarker) {
					if (caret <= consumed) return { node: text, offset: childIndex };
					if (caret < consumed + length) return { node: text, offset: childIndex + 1 };
					consumed += length;
					continue;
				}
				if (caret <= consumed + length) {
					if (child.nodeType === Node.TEXT_NODE) {
						return { node: child, offset: Math.max(0, caret - consumed) };
					}
					const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT);
					let node: Node | null = null;
					let remaining = Math.max(0, caret - consumed);
					while ((node = walker.nextNode())) {
						const nodeLength = node.textContent?.length ?? 0;
						if (remaining <= nodeLength) return { node, offset: remaining };
						remaining -= nodeLength;
					}
				}
				consumed += length;
			}
			return { node: text, offset: text.childNodes.length };
		}
		const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
		let node: Node | null = null;
		let remaining = caret;
		while ((node = walker.nextNode())) {
			const length = node.textContent?.length ?? 0;
			if (remaining <= length) return { node, offset: remaining };
			remaining -= length;
		}
		const last = text.lastChild;
		if (last?.nodeType === Node.TEXT_NODE) {
			return { node: last, offset: last.textContent?.length ?? 0 };
		}
		return { node: text, offset: text.childNodes.length };
	}

	function selectAt(
		startLine: number,
		startOffset: number,
		endLine = startLine,
		endOffset = startOffset,
		reversed = false
	) {
		flushSync();
		const start = caretNode(startLine, startOffset);
		const end = caretNode(endLine, endOffset);
		if (!container || !start || !end) return;
		try {
			container.focus({ preventScroll: true });
		} catch {
			container.focus();
		}
		const selection = window.getSelection();
		if (reversed) selection?.setBaseAndExtent(end.node, end.offset, start.node, start.offset);
		else selection?.setBaseAndExtent(start.node, start.offset, end.node, end.offset);
		const scroller = container.closest('.scrollable') as HTMLElement | null;
		const row = lineElement(reversed ? startLine : endLine);
		if (scroller && row) revealEditorField(scroller, row);
	}

	function focusAt(index: number, offset: number | null = 0, lineId: number | null = null) {
		let resolved = index;
		if (lineId !== null && lines[index]?.id !== lineId) {
			const byId = lines.findIndex((line) => line.id === lineId);
			if (byId >= 0) resolved = byId;
		}
		const caret = offset ?? lines[resolved]?.text.length ?? 0;
		selectAt(resolved, caret);
	}

	function selectionIsReversed(): boolean {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
		const anchor = pointFromDom(selection.anchorNode, selection.anchorOffset);
		const focus = pointFromDom(selection.focusNode, selection.focusOffset);
		return !!anchor && !!focus && comparePoints(anchor, focus) > 0;
	}

	async function focusAfterRender(index: number, offset: number, lineId: number | null = null) {
		await tick();
		focusAt(index, offset, lineId);
	}

	function parentTaskIndex(index: number): number {
		const line = lines[index];
		if (!line?.isCheck || line.indent === 0) return index;
		for (let cursor = index - 1; cursor >= 0; cursor--) {
			if (lines[cursor].isCheck && lines[cursor].indent === 0) return cursor;
		}
		return index;
	}

	function focusTask(index: number) {
		ignoredFocusLine = null;
		const line = lines[index];
		if (!line?.isCheck) {
			onExitTaskFocus?.();
			return;
		}
		onFocusTask?.(index);
	}

	function dropTaskFocus() {
		ignoredFocusLine = focusLine;
		onExitTaskFocus?.();
	}

	export function focusDefault() {
		const index = focusLine === null ? 0 : Math.max(0, Math.min(focusLine, lines.length - 1));
		void focusAfterRender(index, lines[index]?.text.length ?? 0, lines[index]?.id ?? null);
	}

	/** Replace the whole body from outside (e.g. a title paste seeding the body). */
	export async function replaceBodyWithText(text: string) {
		applyingEdit = true;
		try {
			lines = parseBodyToLines(text);
			draftTaskId = null;
			ignoredFocusLine = null;
			syncBody();
			await tick();
			const last = lines.length - 1;
			await focusAfterRender(last, lines[last]?.text.length ?? 0, lines[last]?.id ?? null);
		} finally {
			applyingEdit = false;
		}
	}

	const focusedRootId = $derived.by(() => {
		if (focusLine === null || focusLine === ignoredFocusLine) return null;
		const index = Math.max(0, Math.min(focusLine, lines.length - 1));
		const root = parentTaskIndex(index);
		return lines[root]?.isCheck ? lines[root].id : null;
	});

	function handleEditorClick(event: MouseEvent) {
		// A touch can start on the checkbox and finish over the editable label. In
		// that case Safari may retarget its synthetic click to the task row. Keep
		// the whole gesture owned by the checkbox so it cannot open the keyboard.
		if (checklistPointerId !== null || subtaskPointerId !== null) return;
		if ((event.target as Element)?.closest?.('[data-add-subtask]')) return;
		const row = closestLineElement(event.target as Node);
		if (!row) return;
		const index = lineIndexOfElement(row);
		if (index === null) return;
		const scroller = container?.closest('.scrollable') as HTMLElement | null;
		const anchorTop = row.getBoundingClientRect().top;
		focusTask(index);
		flushSync();
		if (scroller) scroller.scrollTop += row.getBoundingClientRect().top - anchorTop;
	}

	function syncLineFromDom(index: number): boolean {
		const line = lines[index];
		if (!line) return false;
		const rawText = textElement(index)?.textContent ?? '';
		const text = rawText.replaceAll('\u00a0', ' ');
		if (line.text === text) return false;

		line.text = text;
		if (!line.isCheck && CHECK_RE.test(line.text)) {
			const parsed = parseCheckLine(line.text);
			if (parsed) {
				line.isCheck = true;
				line.isBullet = false;
				line.checked = parsed.checked;
				line.indent = Math.min(MAX_TASK_INDENT, parsed.indent);
				line.text = parsed.text;
				ignoredFocusLine = null;
				onFocusTask?.(index);
				flushSync();
				focusAt(index, line.text.length, line.id);
				syncBody();
				return true;
			}
		}
		if (!line.isCheck && !line.isBullet && BULLET_RE.test(line.text)) {
			const parsed = parseBulletLine(line.text);
			if (parsed) {
				line.isBullet = true;
				line.indent = Math.min(MAX_LIST_INDENT, parsed.indent);
				line.text = parsed.text;
				flushSync();
				focusAt(index, line.text.length, line.id);
				syncBody();
				return true;
			}
		}
		if (line.id === draftTaskId && line.text.trim()) draftTaskId = null;
		syncBody();
		return true;
	}

	function readDomIntoLines() {
		if (!container) return;
		let changed = false;
		for (let index = 0; index < lines.length; index++) {
			const text = (textElement(index)?.textContent ?? '').replaceAll('\u00a0', ' ');
			if (lines[index].text !== text) {
				lines[index].text = text;
				changed = true;
			}
			if (!lines[index].isCheck && CHECK_RE.test(lines[index].text)) {
				const parsed = parseCheckLine(lines[index].text);
				if (parsed) {
					lines[index].isCheck = true;
					lines[index].isBullet = false;
					lines[index].checked = parsed.checked;
					lines[index].indent = Math.min(MAX_TASK_INDENT, parsed.indent);
					lines[index].text = parsed.text;
					ignoredFocusLine = null;
					onFocusTask?.(index);
					flushSync();
					focusAt(index, lines[index].text.length, lines[index].id);
					changed = true;
				}
			}
			if (!lines[index].isCheck && !lines[index].isBullet && BULLET_RE.test(lines[index].text)) {
				const parsed = parseBulletLine(lines[index].text);
				if (parsed) {
					lines[index].isBullet = true;
					lines[index].indent = Math.min(MAX_LIST_INDENT, parsed.indent);
					lines[index].text = parsed.text;
					flushSync();
					focusAt(index, lines[index].text.length, lines[index].id);
					changed = true;
				}
			}
			if (lines[index].id === draftTaskId && lines[index].text.trim()) draftTaskId = null;
		}
		if (changed) syncBody();
	}

	/** Sync the line holding the caret; fall back to a full read if it is unknown. */
	function syncEditedLine(index = lineIndexOfElement(window.getSelection()?.focusNode ?? null)) {
		if (index === null) readDomIntoLines();
		else syncLineFromDom(index);
	}

	let replacementLine: number | null = null;
	function handleInput(rawEvent: Event) {
		if (applyingEdit) return;
		const event = rawEvent as InputEvent;
		if (composing || event.isComposing) return;
		syncEditedLine(event.inputType === 'insertReplacementText' ? replacementLine : undefined);
		replacementLine = null;
	}

	function replaceSelectedRange(range: EditorRange, replacement = ''): EditorPoint {
		const { start, end } = range;
		if (start.line === end.line) {
			const line = lines[start.line];
			const removesWholeRow =
				replacement.length === 0 && start.offset === 0 && end.offset === line.text.length;
			if (removesWholeRow) {
				lines.splice(start.line, 1);
				if (line.id === draftTaskId) draftTaskId = null;
				if (lines.length === 0) lines.push(newLine());
				const nextLine = Math.min(start.line, lines.length - 1);
				syncBody();
				return { line: nextLine, offset: 0 };
			}
			line.text = line.text.slice(0, start.offset) + replacement + line.text.slice(end.offset);
			syncBody();
			return {
				line: start.line,
				offset: start.offset + replacement.length
			};
		}

		const first = lines[start.line];
		const last = lines[end.line];
		const merged = first.text.slice(0, start.offset) + replacement + last.text.slice(end.offset);
		const removesWholeRows =
			start.offset === 0 && end.offset === last.text.length && replacement.length === 0;
		if (removesWholeRows) {
			lines.splice(start.line, end.line - start.line + 1);
			if (lines.length === 0) lines.push(newLine());
			const nextLine = Math.min(start.line, lines.length - 1);
			syncBody();
			return { line: nextLine, offset: 0 };
		}

		first.text = merged;
		lines.splice(start.line + 1, end.line - start.line);
		syncBody();
		return {
			line: start.line,
			offset: start.offset + replacement.length
		};
	}

	function handleBeforeInput(rawEvent: Event) {
		if (applyingEdit) {
			rawEvent.preventDefault();
			return;
		}
		const event = rawEvent as InputEvent;
		const range = editorRange();
		if (!range) return;
		if (event.inputType === 'insertReplacementText') {
			// Autocorrect and spelling replacements rewrite one word, often while the
			// caret is being moved by a tap elsewhere. Let the browser apply them so
			// that tap keeps its caret; handleInput syncs the replaced line.
			const target = event.getTargetRanges()[0];
			replacementLine = lineIndexOfElement(target?.startContainer ?? null) ?? range.start.line;
			rememberEdit(range);
			return;
		}
		if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
			// handled below
		} else if (
			(event.inputType === 'insertText' ||
				event.inputType === 'insertCompositionText' ||
				event.inputType === 'deleteContentBackward' ||
				event.inputType === 'deleteContentForward') &&
			range.collapsed
		) {
			recordTypingEdit(range);
		} else if (event.inputType.startsWith('insert') || event.inputType.startsWith('delete')) {
			rememberEdit(range);
		}
		if (range.collapsed) {
			if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
				event.preventDefault();
				rememberEdit(range);
				handleEnter(range);
			}
			return;
		}
		if (event.inputType.startsWith('delete')) {
			event.preventDefault();
			const caret = replaceSelectedRange(range);
			const targetRoot = parentTaskIndex(caret.line);
			if (lines[targetRoot]?.id !== focusedRootId) focusTask(caret.line);
			focusAt(caret.line, caret.offset, lines[caret.line]?.id ?? null);
			return;
		}
		if (event.inputType.startsWith('insert')) {
			event.preventDefault();
			const text = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
			const caret = replaceRangeWithText(range, text);
			const targetRoot = parentTaskIndex(caret.line);
			if (lines[targetRoot]?.id !== focusedRootId) focusTask(caret.line);
			focusAt(caret.line, caret.offset, lines[caret.line]?.id ?? null);
		}
	}

	function selectedText(range: EditorRange): string {
		const selected: string[] = [];
		for (let index = range.start.line; index <= range.end.line; index++) {
			const line = lines[index];
			const start = index === range.start.line ? range.start.offset : 0;
			const end = index === range.end.line ? range.end.offset : line.text.length;
			const text = line.text.slice(start, end);
			const wholeLine = start === 0 && end === line.text.length;
			selected.push(
				line.isCheck && wholeLine
					? formatCheckLine(line.indent, line.checked, text)
					: line.isBullet && wholeLine
						? formatBulletLine(line.indent, text)
						: text
			);
		}
		return selected.join('\n');
	}

	function writeSelectionToClipboard(event: ClipboardEvent): EditorRange | null {
		const range = editorRange();
		if (!range || range.collapsed || !event.clipboardData) return null;
		event.clipboardData.setData('text/plain', selectedText(range));
		event.preventDefault();
		return range;
	}

	function handleCopy(event: ClipboardEvent) {
		writeSelectionToClipboard(event);
	}

	function handleCut(event: ClipboardEvent) {
		const range = writeSelectionToClipboard(event);
		if (!range) return;
		rememberEdit(range);
		const caret = replaceSelectedRange(range);
		focusTask(caret.line);
		focusAt(caret.line, caret.offset, lines[caret.line]?.id ?? null);
	}

	function replaceRangeWithText(range: EditorRange, rawText: string): EditorPoint {
		const parts = rawText.replace(/\r\n?/g, '\n').split('\n');
		if (parts.length === 1) {
			const first = lines[range.start.line];
			const last = lines[range.end.line];
			const prefix = first.text.slice(0, range.start.offset);
			const check = prefix.length === 0 ? parseCheckLine(parts[0]) : null;
			const bullet = !check && prefix.length === 0 ? parseBulletLine(parts[0]) : null;
			if (!check && !bullet) return replaceSelectedRange(range, parts[0]);
			const parsedText = check ? check.text : bullet!.text;
			first.text = parsedText + last.text.slice(range.end.offset);
			if (check) {
				first.isCheck = true;
				first.isBullet = false;
				first.checked = check.checked;
				first.indent = Math.min(MAX_TASK_INDENT, check.indent);
			} else {
				first.isBullet = true;
				first.isCheck = false;
				first.indent = Math.min(MAX_LIST_INDENT, bullet!.indent);
			}
			lines.splice(range.start.line + 1, range.end.line - range.start.line);
			syncBody();
			return {
				line: range.start.line,
				offset: parsedText.length
			};
		}

		const first = lines[range.start.line];
		const last = lines[range.end.line];
		const removedIds = new Set(
			lines.slice(range.start.line, range.end.line + 1).map((line) => line.id)
		);
		const prefix = first.text.slice(0, range.start.offset);
		const suffix = last.text.slice(range.end.offset);
		const firstCheck = prefix.length === 0 ? parseCheckLine(parts[0]) : null;
		const firstBullet = !firstCheck && prefix.length === 0 ? parseBulletLine(parts[0]) : null;
		const inserted: Line[] = [
			firstCheck
				? {
						...first,
						text: firstCheck.text,
						isCheck: true,
						isBullet: false,
						checked: firstCheck.checked,
						indent: Math.min(MAX_TASK_INDENT, firstCheck.indent)
					}
				: firstBullet
					? {
							...first,
							text: firstBullet.text,
							isCheck: false,
							isBullet: true,
							indent: Math.min(MAX_LIST_INDENT, firstBullet.indent)
						}
					: { ...first, text: prefix + parts[0] }
		];
		for (let index = 1; index < parts.length; index++) {
			const check = parseCheckLine(parts[index]);
			const bullet = !check ? parseBulletLine(parts[index]) : null;
			const trailing = index === parts.length - 1 ? suffix : '';
			inserted.push(
				check
					? newLine(
							check.text + trailing,
							true,
							check.checked,
							Math.min(MAX_TASK_INDENT, check.indent)
						)
					: bullet
						? newLine(
								bullet.text + trailing,
								false,
								false,
								Math.min(MAX_LIST_INDENT, bullet.indent),
								true
							)
						: newLine(parts[index] + trailing, first.isCheck, false, first.indent, first.isBullet)
			);
		}

		lines.splice(range.start.line, range.end.line - range.start.line + 1, ...inserted);
		if (draftTaskId !== null && removedIds.has(draftTaskId)) draftTaskId = null;
		syncBody();
		const line = range.start.line + inserted.length - 1;
		return {
			line,
			offset: parts.at(-1)?.length ?? 0
		};
	}

	function handlePaste(event: ClipboardEvent) {
		if (!event.clipboardData) return;
		const text = event.clipboardData.getData('text/plain');
		if (!text) return;
		const range = editorRange();

		if (!range) {
			// The caret could not be resolved inside the editor. Normal editing
			// keeps native browser insertion, but on an empty note the paste must
			// still honor the owner's transform instead of letting a markdown
			// heading land untouched in the body.
			if (body) return;
			event.preventDefault();
			const transformed = transformPaste ? transformPaste(text) : null;
			lines = parseBodyToLines(transformed === null ? text : transformed);
			draftTaskId = null;
			syncBody();
			const last = lines.length - 1;
			focusAt(last, lines[last]?.text.length ?? 0, lines[last]?.id ?? null);
			return;
		}

		event.preventDefault();
		// The owner may lift part of the paste (e.g. a markdown heading into the
		// note title); it returns the body text that should actually be inserted.
		const transformed = transformPaste ? transformPaste(text) : null;
		const bodyText = transformed === null ? text : transformed;
		rememberEdit(range);
		const caret = replaceRangeWithText(range, bodyText);
		focusAt(caret.line, caret.offset, lines[caret.line]?.id ?? null);
	}

	function toggleCheck(lineId: number, event: MouseEvent) {
		event.stopPropagation();
		rememberEdit();
		const targetIndex = lines.findIndex((line) => line.id === lineId);
		if (targetIndex < 0) return;
		const tasks = lines.filter((line) => line.isCheck);
		toggleCheckEntries(tasks, tasks.indexOf(lines[targetIndex]));
		syncBody();
	}

	function keepEditorFocus(event: PointerEvent) {
		// A checklist toggle is an action within the editing surface, not a focus target.
		// Preventing the pointer default avoids blurring the editor and dismissing its keyboard.
		// Stopping propagation also keeps note-detail touch handling from treating the
		// toggle as a body tap and scrolling the selected row into view.
		event.preventDefault();
		event.stopPropagation();
		checklistPointerId = event.pointerId;
		const toggle = event.currentTarget as HTMLElement;
		try {
			toggle.setPointerCapture?.(event.pointerId);
		} catch {
			// Pointer capture is best-effort on older Safari versions.
		}
	}

	function finishPointer(event: PointerEvent) {
		if (event.pointerId === checklistPointerId) {
			queueMicrotask(() => {
				if (checklistPointerId === event.pointerId) checklistPointerId = null;
			});
		}
		if (event.pointerId === subtaskPointerId) {
			queueMicrotask(() => {
				if (subtaskPointerId === event.pointerId) subtaskPointerId = null;
			});
		}
	}

	function cancelPointer(event: PointerEvent) {
		if (event.pointerId === checklistPointerId) checklistPointerId = null;
		if (event.pointerId === subtaskPointerId) subtaskPointerId = null;
	}

	function indentLine(index: number, delta: number): { changed: boolean; offsetDelta: number } {
		const line = lines[index];
		if (!line) return { changed: false, offsetDelta: 0 };
		if (line.isCheck) {
			const previousIndent = line.indent;
			const next = Math.max(0, Math.min(MAX_TASK_INDENT, line.indent + delta));
			if (delta > 0) {
				const previous = [...lines.slice(0, index)]
					.reverse()
					.find((candidate) => candidate.isCheck);
				line.indent = Math.min(next, previous ? previous.indent + 1 : 0, MAX_TASK_INDENT);
			} else {
				line.indent = next;
			}
			return { changed: line.indent !== previousIndent, offsetDelta: 0 };
		}
		if (line.isBullet) {
			const previousIndent = line.indent;
			line.indent = Math.max(0, Math.min(MAX_LIST_INDENT, line.indent + delta));
			return { changed: line.indent !== previousIndent, offsetDelta: 0 };
		}
		const indented = adjustTextIndent(line.text, delta);
		if (indented.offsetDelta === 0 && indented.text === line.text) {
			return { changed: false, offsetDelta: 0 };
		}
		line.text = indented.text;
		return { changed: true, offsetDelta: indented.offsetDelta };
	}

	function indentRange(range: EditorRange, delta: number) {
		const reversed = selectionIsReversed();
		const startLine = range.start.line;
		const endLine = range.end.line;
		const startOffset = range.start.offset;
		const endOffset = range.end.offset;
		const selection = window.getSelection();

		let changed = false;
		let startDelta = 0;
		let endDelta = 0;
		for (let index = startLine; index <= endLine; index++) {
			const result = indentLine(index, delta);
			if (index === startLine) startDelta = result.offsetDelta;
			if (index === endLine) endDelta = result.offsetDelta;
			if (result.changed) changed = true;
		}
		if (!changed) return;
		// Drop the native range before the DOM rewrite. Updating text nodes while
		// they are still selected makes contenteditable treat the indent as a delete.
		selection?.removeAllRanges();
		applyingEdit = true;
		try {
			syncBody();
			const focusLine = reversed ? startLine : endLine;
			if (lines[focusLine]?.isCheck) focusTask(focusLine);
			const restoreStart = !range.collapsed && startOffset === 0 ? 0 : startOffset + startDelta;
			selectAt(startLine, restoreStart, endLine, endOffset + endDelta, reversed);
		} finally {
			applyingEdit = false;
		}
	}

	function previousTaskIndex(index: number): number {
		const indent = lines[index]?.isCheck ? lines[index].indent : 0;
		for (let cursor = index - 1; cursor >= 0; cursor--) {
			const candidate = lines[cursor];
			if (!candidate.isCheck) continue;
			if (indent > 0 ? candidate.indent <= indent : candidate.indent === 0) return cursor;
		}
		return Math.max(0, index - 1);
	}

	function handleEnter(range: EditorRange) {
		let index = range.start.line;
		let offset = range.start.offset;
		if (!range.collapsed) {
			const caret = replaceSelectedRange(range);
			index = caret.line;
			offset = caret.offset;
		}
		const line = lines[index];
		if (!line) return;

		if (line.isCheck && line.text.trim() === '') {
			if (line.indent === 0) {
				const replacement = newLine();
				lines.splice(index, 1, replacement);
				if (line.id === draftTaskId) draftTaskId = null;
				dropTaskFocus();
				syncBody();
				focusAt(index, 0, replacement.id);
				return;
			}
			line.indent = 0;
			syncBody();
			focusTask(index);
			focusAt(index, 0, line.id);
			return;
		}
		if (line.isBullet && line.text.trim() === '') {
			if (line.indent === 0) {
				const replacement = newLine();
				lines.splice(index, 1, replacement);
				syncBody();
				focusAt(index, 0, replacement.id);
				return;
			}
			line.indent -= 1;
			syncBody();
			focusAt(index, 0, line.id);
			return;
		}

		const before = line.text.slice(0, offset);
		const after = line.text.slice(offset);
		line.text = before;
		const splitIntoSubtask = line.isCheck && line.indent === 0 && after.length > 0;
		const next = newLine(
			after,
			line.isCheck,
			false,
			splitIntoSubtask ? 1 : line.isCheck || line.isBullet ? line.indent : 0,
			line.isBullet
		);
		lines.splice(index + 1, 0, next);
		if (line.isCheck && !after.trim()) draftTaskId = next.id;
		syncBody();
		if (next.isCheck) focusTask(index + 1);
		focusAt(index + 1, 0, next.id);
	}

	function handleBackspace(range: EditorRange) {
		if (!range.collapsed || range.start.offset !== 0) return false;
		const index = range.start.line;
		const line = lines[index];
		if (index === 0) {
			if (!line.isCheck && !line.isBullet) return false;
			if (line.isBullet && line.indent > 0 && line.text.trim() !== '') {
				line.indent -= 1;
				syncBody();
				focusAt(0, 0, line.id);
				return true;
			}
			if (line.text.trim() !== '') return false;
			const replacement = newLine();
			lines.splice(0, 1, replacement);
			if (line.id === draftTaskId) draftTaskId = null;
			if (line.isCheck) dropTaskFocus();
			syncBody();
			focusAt(0, 0, replacement.id);
			return true;
		}
		if (line.isCheck && line.text.trim() === '') {
			const targetIndex = previousTaskIndex(index);
			const target = lines[targetIndex];
			lines.splice(index, 1);
			if (line.id === draftTaskId) draftTaskId = null;
			syncBody();
			focusTask(targetIndex);
			focusAt(targetIndex, target.text.length, target.id);
			return true;
		}
		if (line.isBullet && line.text.trim() === '') {
			const replacement = newLine();
			lines.splice(index, 1, replacement);
			if (lines.length === 0) lines.push(newLine());
			syncBody();
			focusAt(Math.min(index, lines.length - 1), 0, lines[Math.min(index, lines.length - 1)].id);
			return true;
		}
		if (line.isBullet && line.indent > 0) {
			line.indent -= 1;
			syncBody();
			focusAt(index, 0, line.id);
			return true;
		}
		if (line.isCheck && line.indent > 0) {
			line.indent = 0;
			syncBody();
			focusTask(index);
			focusAt(index, 0, line.id);
			return true;
		}
		const previous = lines[index - 1];
		const join = previous.text.length;
		previous.text += line.text;
		lines.splice(index, 1);
		syncBody();
		focusTask(index - 1);
		focusAt(index - 1, join, previous.id);
		return true;
	}

	function handleKeydown(event: KeyboardEvent) {
		const primaryModifier = event.ctrlKey || event.metaKey;
		if (primaryModifier && !event.altKey && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			if (event.shiftKey) redo();
			else undo();
			return;
		}
		if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'y') {
			event.preventDefault();
			redo();
			return;
		}
		if (event.key === 'Tab' && !event.altKey && !event.metaKey) {
			if (composing) return;
			event.preventDefault();
			const range = editorRange();
			if (!range) return;
			rememberEdit(range);
			indentRange(range, event.shiftKey || event.ctrlKey ? -1 : 1);
			return;
		}
		const range = editorRange();
		if (!range) return;
		if ((event.key === 'Home' || event.key === 'End') && !event.altKey && !primaryModifier) {
			event.preventDefault();
			const offset = event.key === 'Home' ? 0 : (lines[range.start.line]?.text.length ?? 0);
			if (event.shiftKey) selectAt(range.start.line, range.start.offset, range.start.line, offset);
			else selectAt(range.start.line, offset);
			return;
		}
		if (event.key === 'Enter' || event.key === 'NumpadEnter') {
			event.preventDefault();
			rememberEdit(range);
			handleEnter(range);
			return;
		}
		if (
			event.key === 'Backspace' &&
			range.collapsed &&
			range.start.offset === 0 &&
			(range.start.line > 0 || lines[0]?.isCheck || lines[0]?.isBullet)
		) {
			rememberEdit(range);
			if (handleBackspace(range)) event.preventDefault();
		}
	}

	function addSubtask(rootIndex: number) {
		let resolvedRoot = rootIndex;
		if (resolvedRoot < 0 && focusedRootId !== null) {
			resolvedRoot = lines.findIndex((line) => line.id === focusedRootId);
		}
		const root = lines[resolvedRoot];
		if (!root?.isCheck || root.indent !== 0) return;
		if (draftTaskId !== null) {
			const existing = lines.findIndex((line) => line.id === draftTaskId);
			if (existing >= 0) {
				focusAt(existing, 0, draftTaskId);
				return;
			}
			draftTaskId = null;
		}
		let insertAt = resolvedRoot + 1;
		while (insertAt < lines.length && lines[insertAt].isCheck && lines[insertAt].indent > 0)
			insertAt++;
		const draft = newLine('', true, false, 1);
		rememberEdit();
		lines.splice(insertAt, 0, draft);
		draftTaskId = draft.id;
		ignoredFocusLine = null;
		onFocusTask?.(insertAt);
		focusAt(insertAt, 0, draft.id);
	}

	function activateAddSubtask(event: PointerEvent, rootIndex: number) {
		// iOS does not reliably dispatch click for a non-editable button embedded in a
		// plaintext-only editing host. Activate on pointerdown and keep focus in the host.
		event.preventDefault();
		event.stopPropagation();
		subtaskPointerId = event.pointerId;
		const button = event.currentTarget as HTMLElement;
		try {
			button.setPointerCapture?.(event.pointerId);
		} catch {
			// Best-effort on older Safari versions.
		}
		addSubtask(rootIndex);
	}

	function handleAddSubtaskClick(event: MouseEvent, rootIndex: number) {
		event.preventDefault();
		event.stopPropagation();
		if (subtaskPointerId !== null) return;
		addSubtask(rootIndex);
	}

	function discardEmptyDraft() {
		if (draftTaskId === null) return;
		const index = lines.findIndex((line) => line.id === draftTaskId);
		if (index < 0 || lines[index].text.trim()) {
			draftTaskId = null;
			return;
		}
		lines.splice(index, 1);
		draftTaskId = null;
		syncBody();
	}

	function handleEditorBlur(event: FocusEvent) {
		if (subtaskPointerId !== null) return;
		discardEmptyDraft();
		syncBody(true);
		if (event.relatedTarget instanceof Node && container?.contains(event.relatedTarget)) return;
		dropTaskFocus();
	}

	const focusedGroupRows = $derived.by(() => {
		if (focusedRootId === null) return [] as { line: Line; index: number }[];
		const rootIndex = lines.findIndex((line) => line.id === focusedRootId);
		if (rootIndex < 0 || !lines[rootIndex].isCheck) return [];
		const rows = [{ line: lines[rootIndex], index: rootIndex }];
		for (let index = rootIndex + 1; index < lines.length; index++) {
			if (lines[index].isCheck && lines[index].indent === 0) break;
			if (lines[index].isCheck) rows.push({ line: lines[index], index });
		}
		return rows;
	});

	const focusedGroupIds = $derived(new Set(focusedGroupRows.map(({ line }) => line.id)));
	const focusedGroupLastId = $derived(focusedGroupRows.at(-1)?.line.id ?? null);

	const isSingleLine = $derived(lines.length === 1);

	// Reads only the array structure, so typing inside a line never re-chunks.
	const chunks = $derived.by(() => {
		const result: { start: number; lines: Line[] }[] = [];
		for (let start = 0; start < lines.length; start += CHUNK_SIZE) {
			result.push({ start, lines: lines.slice(start, start + CHUNK_SIZE) });
		}
		return result;
	});

	const editor = noteBody({ mode: 'editor' });

	function rowClass(line: Line): string {
		if (!focusedGroupIds.has(line.id)) return editor.row;
		const isRoot = line.id === focusedRootId;
		const isLast = line.id === focusedGroupLastId;
		return noteBody({ mode: 'editor', focused: true, root: isRoot, last: isLast }).row;
	}

	function rowStyle(line: Line): string | undefined {
		const focused = focusedGroupIds.has(line.id);
		if (line.indent === 0 && !focused) return undefined;
		const parts = [`padding-left:calc(${line.indent * 1.25}rem${focused ? ' + 0.5rem' : ''})`];
		if (focused) {
			parts.push('margin-left:-0.5rem', 'margin-right:-0.5rem', 'padding-right:0.5rem');
		}
		return parts.join(';');
	}
</script>

<div
	bind:this={container}
	contenteditable="plaintext-only"
	data-body-editor
	role="textbox"
	tabindex="0"
	aria-multiline="true"
	aria-label="Note body"
	spellcheck="true"
	class={editor.container}
	onbeforeinput={handleBeforeInput}
	oninput={handleInput}
	oncopy={handleCopy}
	oncut={handleCut}
	onpaste={handlePaste}
	onkeydown={handleKeydown}
	onpointerup={finishPointer}
	onpointercancel={cancelPointer}
	onclick={handleEditorClick}
	oncompositionstart={() => (composing = true)}
	oncompositionend={() => {
		composing = false;
		syncEditedLine();
	}}
	onblur={handleEditorBlur}
>
	{#snippet lineRow(line: Line, index: number)}
		{@const check = checklist({ checked: line.checked, indented: line.indent > 0 })}
		{@const inlineTokens = parseInlineMarkdown(line.text)}
		<div
			data-editor-line={index}
			data-line-id={line.id}
			data-task-row={line.isCheck ? '' : undefined}
			data-bullet-row={line.isBullet ? '' : undefined}
			data-focus-group={line.id === focusedRootId ? '' : undefined}
			class={rowClass(line)}
			style={rowStyle(line)}
		>
			{#if line.isCheck}
				<button
					type="button"
					contenteditable="false"
					data-checklist-toggle
					class={[check.root, editor.check]}
					onpointerdown={keepEditorFocus}
					onclick={(event) => toggleCheck(line.id, event)}
					aria-label={line.indent > 0 ? 'Toggle sub-task' : 'Toggle item'}
					aria-pressed={line.checked}
				>
					{#if line.checked}
						<svg viewBox="0 0 16 16" class={check.mark} aria-hidden="true">
							<path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
						</svg>
					{/if}
				</button>
			{:else if line.isBullet}
				<span contenteditable="false" class={editor.bullet} aria-hidden="true">•</span>
			{/if}
			{#if !line.text || (inlineTokens.length === 1 && inlineTokens[0].kind === 'text' && inlineTokens[0].styles.length === 0)}
				<span
					data-line-text
					use:syncEditableText={line.text}
					data-placeholder={line.text.length === 0
						? line.isCheck
							? line.indent > 0
								? 'Sub-task'
								: 'Task'
							: isSingleLine
								? placeholder
								: ''
						: undefined}
					class={[
						markdownStyles,
						'markdown-inline-content',
						uiStore.rawMarkdown && 'markdown-raw',
						css({ minH: '1lh' }),
						noteBody({ mode: 'editor', checked: line.checked, indented: line.indent > 0 }).line
					]}>{line.text}</span
				>
			{:else}
				<span
					data-line-text
					class={[
						markdownStyles,
						'markdown-inline-content',
						uiStore.rawMarkdown && 'markdown-raw',
						css({ minH: '1lh' }),
						noteBody({ mode: 'editor', checked: line.checked, indented: line.indent > 0 }).line
					]}
				>
					{#each inlineTokens as token, tokenIndex (tokenIndex)}
						{#if token.kind === 'text' && token.styles.length === 0}
							{token.text}
						{:else}
							<span
								class={markdownTokenClass(token, uiStore.rawMarkdown)}
								data-markdown-token={token.kind === 'marker'
									? token.marker
									: token.styles.join(' ')}>{token.text}</span
							>
						{/if}
					{/each}
				</span>
			{/if}
			{#if line.id === focusedGroupLastId}
				<button
					type="button"
					contenteditable="false"
					data-add-subtask
					aria-label="Add sub-task"
					class={noteBody({ mode: 'editor', indented: line.indent > 0 }).addSubtask}
					onpointerdown={(event) => activateAddSubtask(event, focusedGroupRows[0]?.index ?? -1)}
					onclick={(event) => handleAddSubtaskClick(event, focusedGroupRows[0]?.index ?? -1)}
				>
					<span aria-hidden="true" class={editor.addSubtask}></span>
				</button>
			{/if}
		</div>
	{/snippet}

	{#each chunks as chunk (chunk.start)}
		<div
			data-editor-chunk
			class={editor.chunk}
			style="contain-intrinsic-block-size:auto {chunk.lines.length * 2}rem"
		>
			{#each chunk.lines as line, offset (line.id)}
				{@render lineRow(line, chunk.start + offset)}
			{/each}
		</div>
	{/each}
</div>
