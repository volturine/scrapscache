<script lang="ts">
	import { flushSync, onMount, tick } from 'svelte';
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
	import { matchTrailingEmoticon } from '$lib/emoticons';
	import { css } from 'styled-system/css';
	import { checklist, noteBody } from 'styled-system/recipes';
	import { markdownStyles } from '$panda/styles';
	import {
		emptyMarkdownTableRow,
		formatMarkdownTable,
		highlightCodeLine,
		isClosingCodeFence,
		isMarkdownTableHeaderRow,
		markdownTableCellRanges,
		markdownTableCells,
		markdownTableDelimiterRow,
		markdownTokenClass,
		matchOpeningCodeFence,
		parseEditorMarkdownBlocks,
		parseInlineMarkdown,
		parseMarkdownBlocks,
		tokenizeMarkdownTableRow,
		type CodeToken,
		type EditorMarkdownBlockInfo,
		type MarkdownBlock
	} from '$lib/markdown';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { tableScroll } from '$lib/tableScroll';
	import MarkdownCopyButton from './MarkdownCopyButton.svelte';

	const MAX_TASK_INDENT = 1;
	/** Gives an empty line a text node Chrome can draw a caret in. Stripped before it is saved. */
	const CARET_HOLDER = '\u200b';
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
		/** Bumped when the browser edited this row's DOM natively, so Svelte rebuilds it. */
		rev: number;
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
			indent: Math.max(0, Math.min(maxIndent, indent)),
			rev: 0
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
	/** A table or code block with the row index just past its last row. */
	type EditorMarkdownBlock = EditorMarkdownBlockInfo & {
		startLineId: number;
	};
	type EditorTableBlock = Extract<EditorMarkdownBlock, { type: 'table' }>;
	type EditorCodeBlock = Extract<EditorMarkdownBlock, { type: 'code' }>;

	/**
	 * Table and code blocks, re-parsed directly on every edit.
	 */
	const markdownBlocks = $derived.by<EditorMarkdownBlock[]>(() => {
		const parsed = parseEditorMarkdownBlocks(lines);
		return parsed.flatMap((block) => {
			// A fence with no code line would render as an empty shell: both markers are hidden.
			if (block.type === 'code' && !codeBlockHasBody(block.lineIndex, block.end)) return [];
			return [
				{
					...block,
					startLineId: lines[block.lineIndex]?.id ?? -1
				}
			];
		});
	});
	let container: HTMLDivElement | null = $state(null);
	let draftTaskId = $state<number | null>(null);
	let ignoredFocusLine = $state<number | null>(null);
	let checklistPointerId: number | null = null;
	let subtaskPointerId: number | null = null;
	let composing = false;
	let applyingEdit = false;
	/** Caret and row text when an IME composition started, to restore the caret after it. */
	let compositionStart: EditorRange | null = null;
	/** Consecutive typing on one row shares an undo step. */
	let lastTyping: { kind: 'insert' | 'delete'; line: number; at: number } | null = null;
	/** An edit happened since tables were last formatted. */
	let tablesNeedFormat = false;
	/** First line id of the table holding the caret, so leaving it can format it. */
	let caretTableId: number | null = null;
	const undoStack: HistoryEntry[] = [];
	const redoStack: HistoryEntry[] = [];

	// Resolved once per block shape so rendering each line is a lookup, not a scan.
	const markdownBlockLayout = $derived.by(() => {
		const blockAt: (EditorMarkdownBlock | null)[] = new Array(lines.length).fill(null);
		for (const block of markdownBlocks) {
			for (let index = block.lineIndex; index < block.end; index++) blockAt[index] = block;
		}
		return blockAt;
	});

	function markdownBlockAt(index: number): EditorMarkdownBlock | null {
		return markdownBlockLayout[index] ?? null;
	}

	/** Read at copy time: a reused block object may carry stale code text. */
	function markdownBlockCopyText(block: EditorMarkdownBlock): string {
		const source = serializeLines(lines.slice(block.lineIndex, block.end));
		if (block.type === 'table') return source;
		return parseMarkdownBlocks(source).find((parsed) => parsed.type === 'code')?.code ?? '';
	}

	function isCodeFenceLine(block: EditorCodeBlock, index: number) {
		if (index === block.lineIndex) return true;
		if (index !== block.end - 1) return false;
		const opening = matchOpeningCodeFence(lines[block.lineIndex]?.text ?? '');
		return !!opening && isClosingCodeFence(lines[index]?.text ?? '', opening.marker);
	}

	function codeBlockHasBody(start: number, end: number): boolean {
		const opening = matchOpeningCodeFence(lines[start]?.text ?? '');
		if (!opening) return false;
		for (let index = start + 1; index < end; index++) {
			if (!isClosingCodeFence(lines[index]?.text ?? '', opening.marker)) return true;
		}
		return false;
	}

	/** Opener of a ``` / ``` pair that has no code line yet, or null. */
	function bareCodeOpenerIndex(index: number): number | null {
		const line = lines[index];
		if (!line || line.isCheck || line.isBullet || markdownBlockAt(index)) return null;
		const opening = matchOpeningCodeFence(line.text);
		if (opening) {
			const next = lines[index + 1];
			if (!next || isClosingCodeFence(next.text, opening.marker)) return index;
			return null;
		}
		if (index === 0) return null;
		const opener = matchOpeningCodeFence(lines[index - 1]?.text ?? '');
		if (!opener || markdownBlockAt(index - 1)) return null;
		return isClosingCodeFence(line.text, opener.marker) ? index - 1 : null;
	}

	type TableSpan = { start: number; end: number };

	function tableSpanAt(index: number): TableSpan | null {
		const block = markdownBlockAt(index);
		if (block?.type !== 'table') return null;
		const span = { start: block.lineIndex, end: block.end };
		// Task and bullet rows keep their own prefixes; never rewrite those as table source.
		const rows = lines.slice(span.start, span.end);
		return rows.some((line) => line.isCheck || line.isBullet) ? null : span;
	}

	/** Source of each table as last formatted, keyed by its first row, to skip clean tables. */
	const formattedTables = new Map<number, string>();

	function removeTable(span: TableSpan): EditorPoint {
		const startId = lines[span.start]?.id;
		if (startId !== undefined) formattedTables.delete(startId);
		lines.splice(span.start, span.end - span.start);
		if (lines.length === 0) lines.push(newLine());
		caretTableId = null;
		const line = Math.min(span.start, lines.length - 1);
		syncBody();
		return { line, offset: 0 };
	}

	function formatTable({ start, end }: TableSpan): boolean {
		const rows = lines.slice(start, end);
		const firstId = rows[0]?.id;
		const source = rows.map((line) => line.text);
		if (firstId === undefined || formattedTables.get(firstId) === source.join('\n')) return false;
		const formatted = formatMarkdownTable(source);
		formattedTables.set(firstId, formatted.join('\n'));
		let changed = false;
		rows.forEach((line, offset) => {
			const text = formatted[offset] ?? line.text;
			if (line.text === text) return;
			line.text = text;
			changed = true;
		});
		return changed;
	}

	/**
	 * Pretty-print tables once the caret is elsewhere, like editor table formatters:
	 * after an edit, or when the caret leaves a table. The table being edited is left
	 * alone so typing never shifts text under the caret.
	 */
	function formatSettledTables(caretInEditor = true) {
		if (applyingEdit || composing || !container) return;
		const range = caretInEditor ? editorRange() : null;
		if (caretInEditor && !range) return;
		const current = range ? tableSpanAt(range.start.line) : null;
		const currentId = current ? (lines[current.start]?.id ?? null) : null;
		const leftTable = caretTableId !== null && caretTableId !== currentId;
		caretTableId = currentId;
		if (!tablesNeedFormat && !leftTable) return;
		tablesNeedFormat = false;

		let changed = false;
		for (const block of markdownBlocks) {
			if (block.type !== 'table') continue;
			const span = tableSpanAt(block.lineIndex);
			if (!span) continue;
			if (range && range.end.line >= span.start && range.start.line < span.end) continue;
			if (formatTable(span)) changed = true;
		}
		if (!changed) return;
		syncBody();
		tablesNeedFormat = false;
		if (range) {
			selectAt(
				range.start.line,
				range.start.offset,
				range.end.line,
				range.end.offset,
				selectionIsReversed()
			);
		}
	}

	function selectTableCell(row: number, cell: number) {
		const range = markdownTableCellRanges(lines[row]?.text ?? '')[cell];
		if (range) selectAt(row, range.start, row, range.end);
	}

	/** Tab / Shift+Tab: format the table and select the next or previous cell, adding a row at the end. */
	function moveTableCell(range: EditorRange, direction: 1 | -1): boolean {
		const span = tableSpanAt(range.start.line);
		if (!span) return false;
		const caretCell = markdownTableCellRanges(lines[range.start.line].text).findIndex(
			(candidate) => range.start.offset <= candidate.end
		);
		formatTable(span);
		const columns = markdownTableCells(lines[span.start].text).length;
		const positions: { row: number; cell: number }[] = [];
		for (let row = span.start; row < span.end; row++) {
			if (row === span.start + 1) continue;
			for (let cell = 0; cell < columns; cell++) positions.push({ row, cell });
		}

		let current: number;
		if (range.start.line === span.start + 1) {
			current = direction > 0 ? columns - 1 : columns;
		} else {
			const cell = caretCell < 0 ? columns - 1 : Math.min(caretCell, columns - 1);
			current = positions.findIndex(
				(position) => position.row === range.start.line && position.cell === cell
			);
		}

		let target = positions[Math.max(0, current + direction)];
		if (!target) {
			lines.splice(span.end, 0, newLine(emptyMarkdownTableRow(columns)));
			formatTable({ start: span.start, end: span.end + 1 });
			target = { row: span.end, cell: 0 };
		}
		syncBody();
		tablesNeedFormat = false;
		selectTableCell(target.row, target.cell);
		return true;
	}

	function cellTextParts(source: string): { text: string; hidden: boolean }[] {
		const parts: { text: string; hidden: boolean }[] = [];
		let plain = '';
		for (let index = 0; index < source.length; index++) {
			if (source[index] === '\\' && source[index + 1] === '|') {
				if (plain) parts.push({ text: plain, hidden: false });
				plain = '';
				parts.push({ text: '\\', hidden: true });
				parts.push({ text: '|', hidden: false });
				index++;
				continue;
			}
			plain += source[index];
		}
		if (plain || parts.length === 0) parts.push({ text: plain, hidden: false });
		return parts;
	}

	function writeTableRow(cells: string[]): string {
		return `| ${cells.join(' | ')} |`;
	}

	function insertTableColumn(span: TableSpan, column: number, focusRow: number) {
		for (let row = span.start; row < span.end; row++) {
			const cells = markdownTableCells(lines[row].text);
			const filler = row === span.start + 1 ? '---' : '';
			while (cells.length < column) cells.push(filler);
			cells.splice(column, 0, filler);
			lines[row].text = writeTableRow(cells);
		}
		formatTable(span);
		syncBody();
		tablesNeedFormat = false;
		selectTableCell(focusRow, column);
	}

	function columnIsEmpty(span: TableSpan, column: number): boolean {
		for (let row = span.start; row < span.end; row++) {
			if (row === span.start + 1) continue;
			if ((markdownTableCells(lines[row].text)[column] ?? '').trim() !== '') return false;
		}
		return true;
	}

	function removeTableColumn(span: TableSpan, column: number, focusRow: number) {
		for (let row = span.start; row < span.end; row++) {
			const cells = markdownTableCells(lines[row].text);
			cells.splice(column, 1);
			lines[row].text = writeTableRow(cells);
		}
		formatTable(span);
		syncBody();
		tablesNeedFormat = false;
		const next = Math.min(column, markdownTableCells(lines[focusRow].text).length - 1);
		selectTableCell(focusRow, Math.max(0, next));
	}

	/**
	 * Enter inside a table adds a row below and moves to its first cell; Enter on an
	 * empty last row leaves the table. Enter at the end of a lone `| a | b |` header
	 * creates the delimiter row and a first body row.
	 */
	function handleTableEnter(range: EditorRange): boolean {
		if (!range.collapsed) return false;
		const index = range.start.line;
		const line = lines[index];
		if (!line || line.isCheck || line.isBullet || markdownBlockAt(index)?.type === 'code') {
			return false;
		}
		const span = tableSpanAt(index);

		if (!span) {
			if (range.start.offset !== line.text.length || !isMarkdownTableHeaderRow(line.text)) {
				return false;
			}
			const columns = markdownTableCells(line.text).length;
			const delimiter = newLine(markdownTableDelimiterRow(columns));
			const row = newLine(emptyMarkdownTableRow(columns));
			lines.splice(index + 1, 0, delimiter, row);
			formatTable({ start: index, end: index + 3 });
			syncBody();
			tablesNeedFormat = false;
			caretTableId = line.id;
			selectTableCell(index + 2, 0);
			return true;
		}

		const columns = markdownTableCells(lines[span.start].text).length;
		const isLastBodyRow = index === span.end - 1 && index >= span.start + 2;
		if (isLastBodyRow && markdownTableCells(line.text).every((cell) => cell.trim() === '')) {
			const exit = newLine();
			lines.splice(index, 1, exit);
			formatTable({ start: span.start, end: index });
			syncBody();
			tablesNeedFormat = false;
			caretTableId = null;
			focusAt(index, 0, exit.id);
			return true;
		}

		const insertAt = Math.max(index + 1, span.start + 2);
		lines.splice(insertAt, 0, newLine(emptyMarkdownTableRow(columns)));
		formatTable({ start: span.start, end: span.end + 1 });
		syncBody();
		tablesNeedFormat = false;
		selectTableCell(insertAt, 0);
		return true;
	}

	/** Mod+Enter anywhere in a table starts a paragraph right below it. */
	function exitTable(range: EditorRange): boolean {
		const span = tableSpanAt(range.start.line);
		if (!span) return false;
		const line = newLine();
		lines.splice(span.end, 0, line);
		syncBody();
		focusAt(span.end, 0, line.id);
		return true;
	}

	/**
	 * ArrowUp / ArrowDown open a paragraph when a table touches the note's edge.
	 * In a rendered table they also keep the column and skip the hidden delimiter row.
	 */
	function moveTableRow(range: EditorRange, direction: 1 | -1): boolean {
		if (!range.collapsed) return false;
		const index = range.start.line;
		const span = tableSpanAt(index);
		if (!span) return false;
		const atEdge = direction < 0 ? index === 0 : index === lines.length - 1;
		const cells = markdownTableCellRanges(lines[index].text);
		const found = cells.findIndex((cell) => range.start.offset <= cell.end);
		const cellIndex = found < 0 ? cells.length - 1 : found;
		const column = Math.max(0, range.start.offset - (cells[cellIndex]?.start ?? 0));
		let target = index + direction;
		if (target === span.start + 1) target += direction;

		if (target >= span.start && target < span.end) {
			const targetCells = markdownTableCellRanges(lines[target].text);
			const cell = targetCells[Math.min(cellIndex, targetCells.length - 1)];
			selectAt(target, cell ? Math.min(cell.start + column, cell.end) : 0);
			return true;
		}
		if (target < 0 || target >= lines.length) {
			rememberEdit(range);
			const line = newLine();
			const insertAt = target < 0 ? 0 : lines.length;
			lines.splice(insertAt, 0, line);
			syncBody();
			focusAt(insertAt, 0, line.id);
			return true;
		}
		if (focusNeighboringBlock(target, direction, column)) return true;
		focusTask(target);
		focusAt(target, direction < 0 ? lines[target].text.length : 0, lines[target].id);
		return true;
	}

	function codeBodyIndexes(block: EditorCodeBlock): number[] {
		const indexes: number[] = [];
		for (let index = block.lineIndex; index < block.end; index++) {
			if (!isCodeFenceLine(block, index)) indexes.push(index);
		}
		return indexes;
	}

	function focusLineAt(index: number, offset: number) {
		const line = lines[index];
		if (!line) return;
		focusTask(index);
		focusAt(index, offset, line.id);
	}

	function focusCodeEdge(block: EditorCodeBlock, edge: 'start' | 'end', column: number): boolean {
		const body = codeBodyIndexes(block);
		if (body.length === 0) return false;
		const target = edge === 'start' ? body[0] : body[body.length - 1];
		focusLineAt(target, Math.min(Math.max(0, column), lines[target].text.length));
		return true;
	}

	function focusTableEdge(span: TableSpan, edge: 'start' | 'end'): boolean {
		let row = edge === 'start' ? span.start : span.end - 1;
		if (row === span.start + 1) row += edge === 'start' ? 1 : -1;
		if (row < span.start || row >= span.end) return false;
		const cell = markdownTableCellRanges(lines[row]?.text ?? '')[0];
		focusLineAt(row, cell?.start ?? 0);
		return true;
	}

	/** Land inside a table or code block instead of on its hidden fence or delimiter. */
	function focusNeighboringBlock(index: number, direction: 1 | -1, column: number): boolean {
		const block = markdownBlockAt(index);
		if (block?.type === 'code')
			return focusCodeEdge(block, direction > 0 ? 'start' : 'end', column);
		const table = tableSpanAt(index);
		if (table) return focusTableEdge(table, direction > 0 ? 'start' : 'end');
		const opener = bareCodeOpenerIndex(index);
		if (opener === null) return false;
		rememberEdit();
		return openCodeBlockAt(opener);
	}

	function openCodeBlockAt(index: number): boolean {
		const line = lines[index];
		const opening = line ? matchOpeningCodeFence(line.text) : null;
		if (!line || !opening || line.isCheck || line.isBullet || markdownBlockAt(index)) return false;
		const next = lines[index + 1];
		const body = newLine();
		if (next && isClosingCodeFence(next.text, opening.marker)) lines.splice(index + 1, 0, body);
		else lines.splice(index + 1, 0, body, newLine(opening.marker));
		syncBody();
		focusLineAt(index + 1, 0);
		return true;
	}

	/**
	 * A fence typed in front of an existing paragraph would swallow that paragraph.
	 * Close it first so the following lines stay put and the fence stays editable.
	 */
	function sealSwallowedFence(index: number) {
		const line = lines[index];
		const opening = line ? matchOpeningCodeFence(line.text) : null;
		if (!line || !opening || line.isCheck || line.isBullet) return;
		const block = markdownBlockAt(index);
		if (block?.type !== 'code' || block.lineIndex !== index) return;
		if (block.end === index + 1) return;
		if (isCodeFenceLine(block, block.end - 1) && block.end - 1 !== index) return;
		lines.splice(index + 1, 0, newLine(opening.marker));
		syncBody();
	}

	function codeLanguageField(block: EditorCodeBlock): HTMLInputElement | null {
		return container?.querySelector(
			`[data-code-language="${block.lineIndex}"]`
		) as HTMLInputElement | null;
	}

	function setCodeLanguage(block: EditorCodeBlock, raw: string) {
		const line = lines[block.lineIndex];
		const opening = line ? matchOpeningCodeFence(line.text) : null;
		if (!line || !opening) return;
		const indent = line.text.match(/^[ \t]*/)?.[0] ?? '';
		const language = raw.replace(/[^\w.+#-]/g, '').slice(0, 32);
		const next = `${indent}${opening.marker}${language}`;
		if (line.text === next) return;
		line.text = next;
		syncBody();
	}

	function onCodeLanguageKeydown(event: KeyboardEvent, block: EditorCodeBlock) {
		event.stopPropagation();
		if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== 'ArrowUp') return;
		event.preventDefault();
		if (event.key === 'ArrowUp') {
			const previous = block.lineIndex - 1;
			if (previous >= 0) {
				focusLineAt(previous, lines[previous].text.length);
				return;
			}
			rememberEdit();
			const line = newLine();
			lines.splice(0, 0, line);
			syncBody();
			focusLineAt(0, 0);
			return;
		}
		const body = codeBodyIndexes(block);
		if (body.length > 0) focusLineAt(body[0], 0);
	}

	function moveCodeRow(range: EditorRange, direction: 1 | -1): boolean {
		if (!range.collapsed) return false;
		const index = range.start.line;
		const block = markdownBlockAt(index);
		if (block?.type !== 'code') return false;
		const column = range.start.offset;
		const body = codeBodyIndexes(block);
		const position = body.indexOf(index);
		if (position < 0) return focusCodeEdge(block, direction > 0 ? 'start' : 'end', column);
		if (direction < 0 && position === 0) {
			const field = codeLanguageField(block);
			if (field) {
				field.focus();
				field.select();
				return true;
			}
		}
		const next = position + direction;
		if (next >= 0 && next < body.length) {
			focusLineAt(body[next], Math.min(column, lines[body[next]].text.length));
			return true;
		}
		const outside = direction < 0 ? block.lineIndex - 1 : block.end;
		if (outside < 0 || outside >= lines.length) {
			rememberEdit(range);
			const line = newLine();
			const insertAt = outside < 0 ? 0 : lines.length;
			lines.splice(insertAt, 0, line);
			syncBody();
			focusLineAt(insertAt, 0);
			return true;
		}
		if (focusNeighboringBlock(outside, direction, column)) return true;
		focusLineAt(
			outside,
			direction < 0 ? lines[outside].text.length : Math.min(column, lines[outside].text.length)
		);
		return true;
	}

	function movePlainRow(range: EditorRange, direction: 1 | -1): boolean {
		if (!range.collapsed || markdownBlockAt(range.start.line)) return false;
		const next = range.start.line + direction;
		if (next < 0 || next >= lines.length) return true;
		if (focusNeighboringBlock(next, direction, range.start.offset)) return true;
		const length = lines[next].text.length;
		focusLineAt(next, direction < 0 ? length : Math.min(range.start.offset, length));
		return true;
	}

	function lockCaret(line: number, offset: number) {
		requestAnimationFrame(() => {
			if (document.activeElement !== container) return;
			const now = editorRange();
			if (now?.collapsed && now.start.line === line && now.start.offset === offset) return;
			selectAt(line, offset);
		});
	}

	function moveIntoMarkdownBlock(range: EditorRange, direction: 1 | -1): boolean {
		if (!range.collapsed || markdownBlockAt(range.start.line)) return false;
		const index = range.start.line;
		const neighbor = index + direction;
		if (neighbor >= lines.length) {
			if (direction < 0 || bareCodeOpenerIndex(index) !== index) return false;
			rememberEdit(range);
			return openCodeBlockAt(index);
		}
		if (neighbor < 0) return false;
		return focusNeighboringBlock(neighbor, direction, range.start.offset);
	}

	function openCodeBlock(range: EditorRange): boolean {
		if (!range.collapsed || range.start.offset !== lines[range.start.line]?.text.length)
			return false;
		if (bareCodeOpenerIndex(range.start.line) !== range.start.line) return false;
		return openCodeBlockAt(range.start.line);
	}

	function exitCode(range: EditorRange): boolean {
		const block = markdownBlockAt(range.start.line);
		if (block?.type !== 'code') return false;
		const line = newLine();
		lines.splice(block.end, 0, line);
		syncBody();
		focusLineAt(block.end, 0);
		return true;
	}

	function codeFenceBetween(index: number, nextIndex: number): boolean {
		const current = markdownBlockAt(index);
		const next = markdownBlockAt(nextIndex);
		if (current?.type === 'code' && isCodeFenceLine(current, index)) return true;
		if (next?.type === 'code' && isCodeFenceLine(next, nextIndex)) return true;
		if (current?.type === 'code' && next !== current) return true;
		if (next?.type === 'code' && current !== next) return true;
		return false;
	}

	function handleCodeBackspace(index: number): boolean {
		const block = markdownBlockAt(index);
		if (block?.type !== 'code') {
			if (index > 0 && codeFenceBetween(index - 1, index)) {
				const previous = markdownBlockAt(index - 1);
				const landing =
					previous?.type === 'code' ? (codeBodyIndexes(previous).at(-1) ?? index - 1) : index - 1;
				focusNeighboringBlock(index - 1, -1, lines[landing]?.text.length ?? 0);
				return true;
			}
			return false;
		}
		if (isCodeFenceLine(block, index)) {
			focusCodeEdge(block, 'start', 0);
			return true;
		}
		const body = codeBodyIndexes(block);
		if (index !== body[0]) {
			if (isCodeFenceLine(block, index - 1)) return true;
			const previous = lines[index - 1];
			const join = previous.text.length;
			previous.text += lines[index].text;
			lines.splice(index, 1);
			syncBody();
			focusLineAt(index - 1, join);
			return true;
		}
		if (lines[index].text.length === 0 && body.length === 1) {
			const replacement = newLine();
			lines.splice(block.lineIndex, block.end - block.lineIndex, replacement);
			syncBody();
			focusLineAt(block.lineIndex, 0);
			return true;
		}
		if (block.lineIndex === 0) return true;
		focusLineAt(block.lineIndex - 1, lines[block.lineIndex - 1].text.length);
		return true;
	}

	function handleSelectionChange() {
		if (!container) return;
		const line = editorRange()?.start.line;
		const inBlock = line !== undefined && markdownBlockAt(line) !== null;
		container.spellcheck = !inBlock;
		if (document.activeElement === container) formatSettledTables();
	}

	let lastSerializedBody = body;
	let syncBodyTimer: ReturnType<typeof setTimeout> | null = null;
	function syncBody(immediate = false) {
		tablesNeedFormat = true;
		if (immediate) {
			if (syncBodyTimer) {
				clearTimeout(syncBodyTimer);
				syncBodyTimer = null;
			}
			lastSerializedBody = serializeLines(lines.filter((line) => line.id !== draftTaskId));
			// Only a real change is input. The owner's save timer calls syncBodyNow,
			// and reporting input there re-armed that timer forever.
			if (lastSerializedBody === body) return;
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
		if (!row || !container.contains(row)) {
			if (node instanceof Element && container.contains(node)) {
				return pointBetweenRows(node, offset);
			}
			return null;
		}
		const line = lineIndexOfElement(row);
		if (line === null || !lines[line]) return null;
		// The empty-line caret holder is not note text.
		if (lines[line].text.length === 0) return { line, offset: 0 };
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
				local = range.toString().replaceAll('\u200b', '').length;
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

	/** Pop the newest entry that differs from the current body; no-op edits leave duplicates. */
	function popChanged(stack: HistoryEntry[], current: string): HistoryEntry | undefined {
		let entry = stack.pop();
		while (entry && entry.body === current) entry = stack.pop();
		return entry;
	}

	function undo() {
		lastTyping = null;
		const current = historyEntry();
		const entry = popChanged(undoStack, current.body);
		if (!entry) return;
		redoStack.push(current);
		void restoreHistory(entry);
	}

	function redo() {
		lastTyping = null;
		const current = historyEntry();
		const entry = popChanged(redoStack, current.body);
		if (!entry) return;
		undoStack.push(current);
		void restoreHistory(entry);
	}

	type DomPoint = { node: Node; offset: number };

	/**
	 * Resolve a source offset to a DOM position inside `root`. Hidden Markdown
	 * markers cannot hold a caret, so offsets touching them land on the nearest
	 * visible text instead.
	 */
	function caretWithin(root: Node, caret: number): DomPoint | null {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let consumed = 0;
		let lastVisible: { node: Node; end: number } | null = null;
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const length = node.textContent?.length ?? 0;
			const hidden = node.parentElement?.closest('.markdown-token-marker-hidden');
			if (hidden && root.contains(hidden)) {
				if (caret < consumed + length) {
					if (lastVisible?.end === caret) {
						return { node: lastVisible.node, offset: lastVisible.node.textContent?.length ?? 0 };
					}
					const parent = hidden.parentNode;
					if (!parent) return null;
					const index = Array.prototype.indexOf.call(parent.childNodes, hidden);
					return { node: parent, offset: index + (caret > consumed ? 1 : 0) };
				}
				consumed += length;
				continue;
			}
			if (length > 0 && caret <= consumed + length) return { node, offset: caret - consumed };
			consumed += length;
			if (length > 0) lastVisible = { node, end: consumed };
		}
		if (lastVisible?.end === caret) {
			return { node: lastVisible.node, offset: lastVisible.node.textContent?.length ?? 0 };
		}
		return null;
	}

	function caretNode(index: number, offset: number): DomPoint | null {
		const resolved = Math.max(0, Math.min(index, lines.length - 1));
		const text = textElement(resolved);
		if (!text) return null;
		const source = lines[resolved].text;
		if (source.length === 0) {
			const holder = text.firstChild;
			if (holder?.nodeType === Node.TEXT_NODE) return { node: holder, offset: 0 };
			return { node: text, offset: 0 };
		}
		const caret = Math.max(0, Math.min(offset, source.length));
		if (text.querySelector('[data-markdown-table-cell]')) {
			// Keep the caret inside a cell, even an empty one, rather than beside its pipes.
			const cells = markdownTableCellRanges(source);
			const cellIndex = cells.findIndex((cell) => caret >= cell.start && caret <= cell.end);
			const cell = text.querySelector(`[data-markdown-table-cell="${cellIndex}"]`);
			if (cell) {
				return caretWithin(cell, caret - cells[cellIndex].start) ?? { node: cell, offset: 0 };
			}
		}
		return caretWithin(text, caret) ?? { node: text, offset: text.childNodes.length };
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

	// WebKit settles whether a content-visibility chunk is on screen in the first
	// frame that paints it. A chunk focused before then is recorded as offscreen
	// and stops painting when focus leaves, though it is still in view. Opening a
	// new note focuses the body on mount, so that focus waits for the first paint.
	let painted = false;
	let resolvePainted = () => {};
	const firstPaint = new Promise<void>((resolve) => (resolvePainted = resolve));
	onMount(() => {
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => {
				painted = true;
				resolvePainted();
			});
		});
		return () => cancelAnimationFrame(frame);
	});

	export function focusDefault() {
		if (!painted) {
			void firstPaint.then(focusDefault);
			return;
		}
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

	// A second tap inside an already-focused plaintext editor often never fires
	// click, so the highlight would stay on the previously focused task.
	const TAP_SLOP = 8;
	let tapOrigin: { id: number; x: number; y: number } | null = null;

	function lineIndexFromEvent(event: MouseEvent, allowSelection: boolean): number | null {
		const direct = lineIndexOfElement(event.target instanceof Node ? event.target : null);
		if (direct !== null) return direct;
		// The hit can land on a chunk wrapper. Resolve the line from the tap point,
		// then from the caret click has already placed.
		const fromPoint = document.caretRangeFromPoint?.(event.clientX, event.clientY);
		if (fromPoint) {
			const index = lineIndexOfElement(fromPoint.startContainer);
			if (index !== null) return index;
		}
		if (!allowSelection) return null;
		return lineIndexOfElement(window.getSelection()?.focusNode ?? null);
	}

	function handFocus(event: MouseEvent, allowSelection: boolean) {
		// A touch can start on the checkbox and finish over the editable label. In
		// that case Safari may retarget its synthetic click to the task row. Keep
		// the whole gesture owned by the checkbox so it cannot open the keyboard.
		if (checklistPointerId !== null || subtaskPointerId !== null) return;
		if (
			(event.target as Element)?.closest?.(
				'[data-add-subtask], [data-checklist-toggle], [data-code-language]'
			)
		)
			return;
		let index = lineIndexFromEvent(event, allowSelection);
		if (index === null) {
			const shell = (event.target as Element | null)?.closest?.('[data-markdown-block-line]');
			if (!shell || (event.target as Element | null)?.closest?.('button, [data-editor-line]')) {
				return;
			}
			const start = Number(shell.getAttribute('data-markdown-block-line'));
			const block = markdownBlockAt(start);
			if (block?.type === 'code') focusCodeEdge(block, 'start', 0);
			else if (block?.type === 'table')
				focusTableEdge({ start: block.lineIndex, end: block.end }, 'start');
			return;
		}
		const code = markdownBlockAt(index);
		if (code?.type === 'code' && !isCodeFenceLine(code, index) && lines[index].text.length === 0) {
			focusLineAt(index, 0);
			return;
		}
		const row = lineElement(index);
		const scroller = container?.closest('.scrollable') as HTMLElement | null;
		const anchorTop = row?.getBoundingClientRect().top;
		focusTask(index);
		flushSync();
		if (scroller && row && anchorTop !== undefined)
			scroller.scrollTop += row.getBoundingClientRect().top - anchorTop;
	}

	function trackTap(event: PointerEvent) {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		tapOrigin = { id: event.pointerId, x: event.clientX, y: event.clientY };
	}

	function handleEditorClick(event: MouseEvent) {
		handFocus(event, true);
	}

	/**
	 * Promote a row typed as `[ ] ` or `- ` into a task or bullet. Returns how many
	 * characters of prefix were consumed so the caret can follow.
	 */
	function applyLinePrefix(index: number): number {
		const line = lines[index];
		// Code and table rows keep their text verbatim.
		if (!line || line.isCheck || markdownBlockAt(index)) return 0;
		const check = CHECK_RE.test(line.text) ? parseCheckLine(line.text) : null;
		if (check) {
			const consumed = line.text.length - check.text.length;
			line.isCheck = true;
			line.isBullet = false;
			line.checked = check.checked;
			line.indent = Math.min(MAX_TASK_INDENT, check.indent);
			line.text = check.text;
			ignoredFocusLine = null;
			onFocusTask?.(index);
			return consumed;
		}
		if (line.isBullet || !BULLET_RE.test(line.text)) return 0;
		const bullet = parseBulletLine(line.text);
		if (!bullet) return 0;
		const consumed = line.text.length - bullet.text.length;
		line.isBullet = true;
		line.indent = Math.min(MAX_LIST_INDENT, bullet.indent);
		line.text = bullet.text;
		return consumed;
	}

	/**
	 * Adopt text the browser wrote into the DOM itself (IME composition, or an
	 * input we could not intercept). Changed rows are rebuilt from the model so
	 * browser-made nodes never linger next to Svelte-owned ones.
	 */
	function reconcileDom(
		caretLine: number | null,
		caretOffset: number,
		caretIsPostMutation = false
	) {
		if (!container) return;
		let changed = false;
		let caret = caretOffset;
		for (let index = 0; index < lines.length; index++) {
			const element = textElement(index);
			if (!element) continue;
			const text = (element.textContent ?? '').replaceAll('\u00a0', ' ').replaceAll('\u200b', '');
			const line = lines[index];
			if (text === line.text) continue;
			changed = true;
			// The input path reads the caret after the browser already wrote the
			// text, so only the composition path may add the length delta itself.
			if (index === caretLine && !caretIsPostMutation) caret += text.length - line.text.length;
			line.text = text;
			line.rev++;
			const consumed = applyLinePrefix(index);
			if (index === caretLine) caret -= consumed;
			if (line.id === draftTaskId && line.text.trim()) draftTaskId = null;
		}
		if (!changed) return;
		syncBody();
		if (caretLine === null) return;
		const line = Math.min(caretLine, lines.length - 1);
		focusAt(line, Math.max(0, Math.min(caret, lines[line]?.text.length ?? 0)), lines[line]?.id);
	}

	function handleInput(rawEvent: Event) {
		const languageField = rawEvent.target;
		if (
			languageField instanceof HTMLInputElement &&
			languageField.dataset.codeLanguage !== undefined
		) {
			const block = markdownBlockAt(Number(languageField.dataset.codeLanguage));
			if (block?.type === 'code') setCodeLanguage(block, languageField.value);
			return;
		}
		if (applyingEdit) return;
		const event = rawEvent as InputEvent;
		if (composing) {
			const stillComposing =
				event.isComposing ||
				event.inputType === 'insertCompositionText' ||
				event.inputType === 'deleteCompositionText';
			if (stillComposing) return;
			// iOS can skip compositionend; a plain input means the session is over.
			composing = false;
			const start = compositionStart;
			compositionStart = null;
			reconcileDom(start?.start.line ?? null, start?.start.offset ?? 0);
			return;
		}
		if (event.isComposing) return;
		const range = editorRange();
		// The browser already wrote the change, so this caret is the final one.
		reconcileDom(range?.start.line ?? null, range?.start.offset ?? 0, true);
	}

	function handleCompositionStart() {
		rememberEdit();
		lastTyping = null;
		compositionStart = editorRange();
		composing = true;
	}

	function handleCompositionEnd() {
		composing = false;
		const start = compositionStart;
		compositionStart = null;
		reconcileDom(start?.start.line ?? null, start?.start.offset ?? 0);
	}

	function replaceSelectedRange(range: EditorRange, replacement = ''): EditorPoint {
		const { start, end } = range;
		if (replacement.length === 0 && start.line !== end.line) {
			const span = tableSpanAt(start.line);
			if (
				span &&
				tableSpanAt(end.line)?.start === span.start &&
				start.line <= span.start &&
				end.line >= span.end - 1
			) {
				return removeTable(span);
			}
		}
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

	const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

	function graphemeBefore(text: string, offset: number): number {
		let previous = 0;
		for (const { index } of graphemes.segment(text)) {
			if (index >= offset) break;
			previous = index;
		}
		return previous;
	}

	function graphemeAfter(text: string, offset: number): number {
		for (const { index, segment } of graphemes.segment(text)) {
			if (index + segment.length > offset) return index + segment.length;
		}
		return text.length;
	}

	const WORD_BEFORE_RE = /(?:[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]+)?\s*$/u;
	const WORD_AFTER_RE = /^\s*(?:[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]+)?/u;

	type DeleteUnit = 'character' | 'word' | 'line';

	/** A rendered table cell that holds `offset`, when pipes must be protected. */
	function protectedCellAt(index: number, offset: number) {
		const span = tableSpanAt(index);
		if (!span || index === span.start + 1) return null;
		const cells = markdownTableCellRanges(lines[index].text);
		const cellIndex = cells.findIndex((cell) => offset >= cell.start && offset <= cell.end);
		return cellIndex < 0 ? null : { span, cells, cellIndex, cell: cells[cellIndex] };
	}

	function finishEdit(caret: EditorPoint) {
		const targetRoot = parentTaskIndex(caret.line);
		if (lines[targetRoot]?.id !== focusedRootId) focusTask(caret.line);
		focusAt(caret.line, caret.offset, lines[caret.line]?.id ?? null);
	}

	/**
	 * A pipe at the end of the last cell adds a column. A pipe in the padding
	 * between cells is written into the cell it follows, so it cannot split the row.
	 */
	function placeTablePipe(
		range: EditorRange,
		text: string
	): 'column' | { text: string; offset: number } | null {
		const index = range.start.line;
		const span = tableSpanAt(index);
		if (!span || index === span.start + 1 || !range.collapsed) return null;
		const cells = markdownTableCellRanges(lines[index].text);
		if (cells.length === 0) return null;
		const offset = range.start.offset;
		let inside = -1;
		for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
			const cell = cells[cellIndex];
			if (offset >= cell.start && offset <= cell.end) inside = cellIndex;
		}
		const last = cells.length - 1;
		// A pipe at the end of a cell, or in the padding after the row, adds a column there.
		if (
			text === '|' &&
			((inside >= 0 && offset === cells[inside].end) || offset > cells[last].end)
		) {
			insertTableColumn(span, inside >= 0 ? inside + 1 : last + 1, index);
			return 'column';
		}
		const escaped = text.replace(/(?<!\\)\|/g, '\\|');
		if (inside >= 0) return { text: escaped, offset };
		let owner = -1;
		for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
			if (offset > cells[cellIndex].end) owner = cellIndex;
		}
		return { text: escaped, offset: cells[owner >= 0 ? owner : 0].end };
	}

	function insertText(range: EditorRange, rawText: string) {
		let text = rawText.replace(/\r\n?/g, '\n');
		const line = lines[range.start.line];
		if (!text || !line) return;
		// `[ ]` and `- ` become a task or bullet as soon as they match; swallow the space typed next.
		if (text === ' ' && range.collapsed && (line.isCheck || line.isBullet) && !line.text) return;
		let insertRange = range;
		// `:)` + space becomes an emoji, except in code blocks and table cells.
		if (
			text === ' ' &&
			range.collapsed &&
			!markdownBlockAt(range.start.line) &&
			!protectedCellAt(range.start.line, range.start.offset)
		) {
			const match = matchTrailingEmoticon(line.text.slice(0, range.start.offset));
			if (match) {
				insertRange = {
					start: { line: range.start.line, offset: match.start },
					end: { line: range.start.line, offset: range.start.offset },
					collapsed: false
				};
				text = `${match.emoji} `;
			}
		}
		if (line.id === draftTaskId && text.trim()) draftTaskId = null;
		if (range.collapsed && !text.includes('\n') && text.includes('|')) {
			const placed = placeTablePipe(range, text);
			if (placed === 'column') return;
			if (placed) {
				text = placed.text;
				insertRange = {
					start: { line: range.start.line, offset: placed.offset },
					end: { line: range.start.line, offset: placed.offset },
					collapsed: true
				};
			}
		} else if (!text.includes('\n') && protectedCellAt(range.start.line, range.start.offset)) {
			text = text.replace(/(?<!\\)\|/g, '\\|');
		}
		const openingBefore = matchOpeningCodeFence(line.text);
		const caret = replaceRangeWithText(insertRange, text);
		const consumed = applyLinePrefix(caret.line);
		if (
			range.collapsed &&
			!text.includes('\n') &&
			!openingBefore &&
			matchOpeningCodeFence(lines[caret.line]?.text ?? '')
		) {
			sealSwallowedFence(caret.line);
		}
		if (consumed > 0) syncBody();
		finishEdit({ ...caret, offset: Math.max(0, caret.offset - consumed) });
	}

	function deleteBackward(range: EditorRange, unit: DeleteUnit) {
		const index = range.start.line;
		const offset = range.start.offset;
		const line = lines[index];
		const tableSpan = tableSpanAt(index);
		if (tableSpan) {
			const cells = markdownTableCellRanges(line.text);
			if (offset === 0 || (cells[0] && offset <= cells[0].start)) {
				deleteEmptyTableRow(index, tableSpan, cells, 0);
				return;
			}
		}
		if (offset === 0) {
			handleBackspace(range);
			return;
		}
		let start =
			unit === 'character'
				? graphemeBefore(line.text, offset)
				: unit === 'word'
					? offset - (line.text.slice(0, offset).match(WORD_BEFORE_RE)?.[0].length ?? 0)
					: 0;
		const cell = protectedCellAt(index, offset);
		if (cell) {
			if (offset === cell.cell.start) {
				deleteEmptyTableRow(index, cell.span, cell.cells, cell.cellIndex);
				return;
			}
			start = Math.max(start, cell.cell.start);
		}
		if (start === offset) return;
		// Remove characters, never the whole row: the caret stays on this line.
		line.text = line.text.slice(0, start) + line.text.slice(offset);
		syncBody();
		finishEdit({ line: index, offset: start });
	}

	function deleteForward(range: EditorRange, unit: DeleteUnit) {
		const index = range.start.line;
		const offset = range.start.offset;
		const line = lines[index];
		let end =
			unit === 'character'
				? graphemeAfter(line.text, offset)
				: unit === 'word'
					? offset + (line.text.slice(offset).match(WORD_AFTER_RE)?.[0].length ?? 0)
					: line.text.length;
		const cell = protectedCellAt(index, offset);
		if (cell) end = Math.min(end, cell.cell.end);
		if (offset === line.text.length) {
			const next = lines[index + 1];
			if (!next || cell || codeFenceBetween(index, index + 1)) return;
			line.text += next.text;
			lines.splice(index + 1, 1);
			if (next.id === draftTaskId) draftTaskId = null;
			syncBody();
			finishEdit(range.start);
			return;
		}
		if (end === offset) return;
		line.text = line.text.slice(0, offset) + line.text.slice(end);
		syncBody();
		finishEdit(range.start);
	}

	/** Backspace at the start of a cell removes an empty column or row, or the whole table. */
	function deleteEmptyTableRow(
		index: number,
		span: TableSpan,
		cells: { start: number; end: number }[],
		cellIndex: number
	) {
		const width = markdownTableCells(lines[span.start].text).length;
		const cell = cells[cellIndex];
		const cellEmpty = !cell || cell.end <= cell.start;
		if (index === span.start && cellIndex === 0) {
			finishEdit(removeTable(span));
			return;
		}
		if (cellEmpty && width > 1 && columnIsEmpty(span, cellIndex)) {
			removeTableColumn(span, cellIndex, index);
			return;
		}
		const isBodyRow = index >= span.start + 2;
		const rowEmpty = cells.every((entry) => entry.end <= entry.start);
		if (isBodyRow && rowEmpty) {
			const lastBodyRow = index === span.end - 1;
			if (lastBodyRow && span.end - span.start <= 3) {
				finishEdit(removeTable(span));
				return;
			}
			lines.splice(index, 1);
			syncBody();
			const previous = index - 1 === span.start + 1 ? span.start : index - 1;
			const previousCells = markdownTableCellRanges(lines[previous].text);
			focusAt(previous, previousCells.at(-1)?.end ?? 0, lines[previous].id);
			return;
		}
		if (cellIndex > 0) {
			const previous = cells[cellIndex - 1];
			focusAt(index, previous?.end ?? 0, lines[index].id);
			return;
		}
		if (index > span.start) {
			const previous = index === span.start + 2 ? span.start : index - 1;
			const previousCells = markdownTableCellRanges(lines[previous].text);
			selectAt(previous, previousCells.at(-1)?.end ?? lines[previous].text.length);
		}
	}

	/** The range an input targets: spellcheck replacements name their own word. */
	function inputTargetRange(event: InputEvent): EditorRange | null {
		const target = event.getTargetRanges?.()[0];
		if (!target || event.inputType !== 'insertReplacementText') return editorRange();
		const start = pointFromDom(target.startContainer, target.startOffset);
		const end = pointFromDom(target.endContainer, target.endOffset);
		if (!start || !end) return editorRange();
		return {
			start,
			end,
			collapsed: start.line === end.line && start.offset === end.offset
		};
	}

	/** Browser-owned composition steps; the DOM is reconciled when composition ends. */
	const NATIVE_INPUT_TYPES = new Set([
		'insertCompositionText',
		'deleteCompositionText',
		'insertFromComposition',
		// iOS autocorrect rewrites a word natively, often while a tap moves the caret.
		'insertReplacementText'
	]);

	/**
	 * Every edit is applied to the line model and re-rendered, so the browser
	 * never mutates the Markdown DOM that Svelte owns.
	 */
	function handleBeforeInput(rawEvent: Event) {
		const event = rawEvent as InputEvent;
		if (
			event.target instanceof HTMLInputElement &&
			event.target.dataset.codeLanguage !== undefined
		) {
			return;
		}
		if (applyingEdit) {
			event.preventDefault();
			return;
		}
		if (composing || event.isComposing || NATIVE_INPUT_TYPES.has(event.inputType)) {
			if (event.inputType === 'insertReplacementText') rememberEdit();
			return;
		}
		const type = event.inputType;
		if (type === 'historyUndo') {
			event.preventDefault();
			return undo();
		}
		if (type === 'historyRedo') {
			event.preventDefault();
			return redo();
		}
		const range = inputTargetRange(event);
		const payload = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
		// iOS delivers software-keyboard and emoji-picker inserts with no payload
		// or no resolvable caret. Canceling those first would drop the input, so
		// let the browser write them and adopt the change through reconcileDom.
		const emptyInsert =
			type.startsWith('insert') &&
			type !== 'insertParagraph' &&
			type !== 'insertLineBreak' &&
			!payload;
		if (!range || emptyInsert) {
			rememberEdit(range);
			return;
		}
		event.preventDefault();

		const kind =
			type === 'insertText' ? 'insert' : type === 'deleteContentBackward' ? 'delete' : null;
		if (kind && range.collapsed) {
			const now = Date.now();
			const continues =
				lastTyping?.kind === kind &&
				lastTyping.line === range.start.line &&
				now - lastTyping.at < 1000 &&
				!/\s/.test(event.data ?? '');
			if (!continues) rememberEdit(range);
			lastTyping = { kind, line: range.start.line, at: now };
		} else {
			lastTyping = null;
			rememberEdit(range);
		}

		if (type === 'insertParagraph' || type === 'insertLineBreak') {
			if (openCodeBlock(range)) return;
			if (!handleTableEnter(range)) handleEnter(range);
			return;
		}
		if (type.startsWith('insert')) {
			insertText(range, event.data ?? event.dataTransfer?.getData('text/plain') ?? '');
			return;
		}
		if (!type.startsWith('delete')) return;
		if (!range.collapsed) {
			finishEdit(replaceSelectedRange(range));
			return;
		}
		const unit: DeleteUnit = type.includes('Word')
			? 'word'
			: type.includes('Line')
				? 'line'
				: 'character';
		if (type.endsWith('Forward')) deleteForward(range, unit);
		else deleteBackward(range, unit);
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
			const parsedText = check ? check.text : bullet ? bullet.text : parts[index];
			inserted.push(
				check
					? newLine(
							parsedText + trailing,
							true,
							check.checked,
							Math.min(MAX_TASK_INDENT, check.indent)
						)
					: bullet
						? newLine(
								parsedText + trailing,
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
		const offset = inserted.at(-1)!.text.length - suffix.length;
		return {
			line,
			offset
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
		const origin = tapOrigin?.id === event.pointerId ? tapOrigin : null;
		if (origin) tapOrigin = null;
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
		// Move the highlight before the browser places the caret, while the id of a
		// checkbox or add-subtask gesture is still set and can veto it.
		if (event.pointerType !== 'touch' || !origin) return;
		if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > TAP_SLOP) return;
		handFocus(event, false);
	}

	function cancelPointer(event: PointerEvent) {
		if (tapOrigin?.id === event.pointerId) tapOrigin = null;
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
		if (handleCodeBackspace(index)) return true;
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
		if (composing || event.isComposing) return;
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
			lastTyping = null;
			if (moveTableCell(range, event.shiftKey ? -1 : 1)) return;
			indentRange(range, event.shiftKey || event.ctrlKey ? -1 : 1);
			return;
		}
		const range = editorRange();
		if (!range) return;
		if ((event.key === 'Home' || event.key === 'End') && !event.altKey && !primaryModifier) {
			event.preventDefault();
			const cells = tableSpanAt(range.start.line)
				? markdownTableCellRanges(lines[range.start.line].text)
				: [];
			const offset =
				event.key === 'Home'
					? (cells[0]?.start ?? 0)
					: (cells.at(-1)?.end ?? lines[range.start.line]?.text.length ?? 0);
			if (event.shiftKey) selectAt(range.start.line, range.start.offset, range.start.line, offset);
			else selectAt(range.start.line, offset);
			return;
		}
		if (
			(event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
			!event.altKey &&
			!event.shiftKey &&
			!primaryModifier
		) {
			const direction = event.key === 'ArrowUp' ? -1 : 1;
			if (
				moveTableRow(range, direction) ||
				moveCodeRow(range, direction) ||
				moveIntoMarkdownBlock(range, direction) ||
				movePlainRow(range, direction)
			) {
				event.preventDefault();
				const placed = editorRange();
				if (placed?.collapsed) lockCaret(placed.start.line, placed.start.offset);
				return;
			}
		}
		if (event.key === 'Enter' || event.key === 'NumpadEnter') {
			event.preventDefault();
			rememberEdit(range);
			lastTyping = null;
			if (primaryModifier && (exitCode(range) || exitTable(range))) return;
			if (openCodeBlock(range)) return;
			if (handleTableEnter(range)) return;
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
		formatSettledTables(false);
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

	type EditorItem =
		| { kind: 'chunk'; key: string; start: number; lines: Line[] }
		| { kind: 'block'; key: string; block: EditorMarkdownBlock };

	// Plain rows stay in offscreen-skipping chunks. Tables and code sit outside
	// those chunks so iOS WebKit does not crash on overflow + content-visibility.
	const editorItems = $derived.by(() => {
		const items: EditorItem[] = [];
		let segmentStart: number | null = null;
		let chunkIndex = 0;
		const flush = (segmentEnd: number) => {
			if (segmentStart === null) return;
			for (let start = segmentStart; start < segmentEnd; start += CHUNK_SIZE) {
				const chunkLines = lines.slice(start, Math.min(segmentEnd, start + CHUNK_SIZE));
				items.push({
					kind: 'chunk',
					key: `c${chunkIndex++}`,
					start,
					lines: chunkLines
				});
			}
			segmentStart = null;
		};
		for (let index = 0; index < lines.length; index++) {
			const block = markdownBlockAt(index);
			if (block && block.lineIndex === index) {
				flush(index);
				items.push({ kind: 'block', key: `b${block.startLineId}`, block });
				index = block.end - 1;
				continue;
			}
			if (block) continue;
			if (segmentStart === null) segmentStart = index;
		}
		flush(lines.length);
		return items;
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

{#snippet inlineEditorContent(text: string)}
	{@const tokens = parseInlineMarkdown(text)}
	{#each tokens as token, tokenIndex (tokenIndex)}
		{#if token.kind === 'text' && token.styles.length === 0}
			{token.text}
		{:else}
			<span
				class={markdownTokenClass(token, uiStore.rawMarkdown)}
				data-markdown-token={token.kind === 'marker' ? token.marker : token.styles.join(' ')}
				>{token.text}</span
			>
		{/if}
	{/each}
{/snippet}

{#snippet codeEditorContent(tokens: CodeToken[])}
	{#each tokens as token, tokenIndex (tokenIndex)}
		{#if token.kind === 'plain'}
			{token.text}
		{:else}
			<span class="markdown-code-token-{token.kind}">{token.text}</span>
		{/if}
	{/each}
{/snippet}

{#snippet tableEditorContent(text: string, block: EditorTableBlock, header: boolean)}
	{@const tableTokens = tokenizeMarkdownTableRow(text)}
	{@const lastCellIndex = tableTokens.filter((token) => token.kind === 'cell').length - 1}
	{#each tableTokens as token, tokenIndex (tokenIndex)}
		{#if token.kind === 'marker'}
			<span class="markdown-editor-table-marker markdown-token-marker-hidden">{token.text}</span>
		{:else}
			<span
				class="markdown-editor-table-cell"
				class:markdown-editor-table-header-cell={header}
				class:markdown-table-last-cell={token.columnIndex === lastCellIndex}
				style={`text-align: ${block.alignments[token.columnIndex] ?? 'left'};`}
				data-markdown-table-cell={token.columnIndex}
			>
				{#each cellTextParts(token.text) as part, partIndex (partIndex)}
					{#if part.hidden}
						<span class="markdown-token-marker-hidden">{part.text}</span>
					{:else if part.text.length === 0}
						{CARET_HOLDER}
					{:else}
						{@render inlineEditorContent(part.text)}
					{/if}
				{/each}
			</span>
		{/if}
	{/each}
{/snippet}

{#snippet editorLine(line: Line, index: number, block: EditorMarkdownBlock | null)}
	{@const check = checklist({ checked: line.checked, indented: line.indent > 0 })}
	{@const tableBlock = block?.type === 'table' ? block : null}
	{@const codeBlock = block?.type === 'code' ? block : null}
	{@const tableSeparator = tableBlock !== null && index === tableBlock.lineIndex + 1}
	{@const codeFence = codeBlock !== null && isCodeFenceLine(codeBlock, index)}
	<div
		data-editor-line={index}
		data-line-id={line.id}
		data-task-row={line.isCheck ? '' : undefined}
		data-bullet-row={line.isBullet ? '' : undefined}
		data-focus-group={line.id === focusedRootId ? '' : undefined}
		data-markdown-table-row={tableBlock ? '' : undefined}
		data-markdown-table-separator={tableSeparator ? '' : undefined}
		data-markdown-code-line={codeBlock && !codeFence ? '' : undefined}
		data-markdown-code-fence={codeFence ? '' : undefined}
		class={rowClass(line)}
		style={tableSeparator ? 'display:none' : rowStyle(line)}
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
		{#key line.rev}
			{#if tableBlock && !tableSeparator}
				<span
					data-line-text
					class={[
						markdownStyles,
						'markdown-inline-content',
						'markdown-editor-table-line',
						css({ minH: '1lh' }),
						noteBody({ mode: 'editor', checked: line.checked, indented: line.indent > 0 }).line
					]}
				>
					{@render tableEditorContent(line.text, tableBlock, index === tableBlock.lineIndex)}
				</span>
			{:else if codeBlock && !codeFence}
				{@const codeTokens = line.text ? highlightCodeLine(line.text, codeBlock.language) : null}
				<span
					data-line-text
					spellcheck="false"
					class={['markdown-inline-content', 'markdown-editor-code-line', css({ minH: '1lh' })]}
				>
					<!-- Most code rows carry no strings, flags, or comments. Writing their text
					straight in, as plain rows do, spares a block per token on every such row. -->
					{#if !codeTokens}
						{CARET_HOLDER}
					{:else if codeTokens.length === 1 && codeTokens[0].kind === 'plain'}
						{line.text}
					{:else}
						{@render codeEditorContent(codeTokens)}
					{/if}
				</span>
			{:else if !line.text || !/[*_~`#]/.test(line.text)}
				<span
					data-line-text
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
					]}>{line.text || CARET_HOLDER}</span
				>
			{:else}
				{@const inlineTokens = parseInlineMarkdown(line.text)}
				{#if inlineTokens.length === 1 && inlineTokens[0].kind === 'text' && inlineTokens[0].styles.length === 0}
					<span
						data-line-text
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
							css({ minH: '1lh' }),
							noteBody({ mode: 'editor', checked: line.checked, indented: line.indent > 0 }).line
						]}
					>
						{@render inlineEditorContent(line.text)}
					</span>
				{/if}
			{/if}
		{/key}
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
				<span aria-hidden="true"></span>
			</button>
		{/if}
	</div>
{/snippet}

<svelte:document onselectionchange={handleSelectionChange} />

<div
	bind:this={container}
	contenteditable="plaintext-only"
	data-body-editor
	role="textbox"
	tabindex="0"
	aria-multiline="true"
	aria-label="Note body"
	spellcheck="true"
	class={[editor.container, markdownStyles, uiStore.rawMarkdown && 'markdown-raw']}
	onbeforeinput={handleBeforeInput}
	oninput={handleInput}
	oncopy={handleCopy}
	oncut={handleCut}
	onpaste={handlePaste}
	onkeydown={handleKeydown}
	onpointerdown={trackTap}
	onpointerup={finishPointer}
	onpointercancel={cancelPointer}
	onclick={handleEditorClick}
	oncompositionstart={handleCompositionStart}
	oncompositionend={handleCompositionEnd}
	onblur={handleEditorBlur}
>
	{#each editorItems as item (item.key)}
		{#if item.kind === 'chunk'}
			<div data-editor-chunk class={editor.chunk}>
				{#each item.lines as line, offset (line.id)}
					{@render editorLine(line, item.start + offset, null)}
				{/each}
			</div>
		{:else}
			{@const block = item.block}
			<div
				class="markdown-block-shell"
				data-markdown-block-line={block.lineIndex}
				data-markdown-editor-table={block.type === 'table' ? '' : undefined}
				data-markdown-editor-code-block={block.type === 'code' ? '' : undefined}
			>
				<MarkdownCopyButton
					text={() => markdownBlockCopyText(block)}
					label={block.type === 'table' ? 'table' : 'code'}
				/>
				{#if block.type === 'code'}
					<div contenteditable="false" class="markdown-code-language-row">
						<input
							contenteditable="false"
							spellcheck="false"
							autocomplete="off"
							aria-label="Code language"
							placeholder="language"
							data-code-language={block.lineIndex}
							class="markdown-code-language"
							value={block.language}
							onfocus={() => rememberEdit()}
							onbeforeinput={(event) => event.stopPropagation()}
							onkeydown={(event) => onCodeLanguageKeydown(event, block)}
						/>
					</div>
				{/if}
				<div
					class="markdown-block-scroll"
					class:note-scrollbar-hidden={block.type !== 'table'}
					class:markdown-editor-table-scroll={block.type === 'table'}
					class:markdown-editor-code-block={block.type === 'code'}
					use:tableScroll={block.type === 'table'}
				>
					{#if block.type === 'table'}
						<div class="markdown-editor-table">
							{#each lines.slice(block.lineIndex, block.end) as blockLine, blockLineOffset (blockLine.id)}
								{@render editorLine(blockLine, block.lineIndex + blockLineOffset, block)}
							{/each}
						</div>
					{:else}
						{#each lines.slice(block.lineIndex, block.end) as blockLine, blockLineOffset (blockLine.id)}
							{@render editorLine(blockLine, block.lineIndex + blockLineOffset, block)}
						{/each}
					{/if}
				</div>
			</div>
		{/if}
	{/each}
</div>
