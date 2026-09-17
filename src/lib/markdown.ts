import { markdownTable } from 'markdown-table';
import stringWidth from 'string-width';
import { parseBody, type BodySegment } from './checklistBody';

export type MarkdownStyle =
	| 'strong'
	| 'emphasis'
	| 'code'
	| 'strikethrough'
	| 'heading-1'
	| 'heading-2'
	| 'heading-3'
	| 'heading-4'
	| 'heading-5'
	| 'heading-6';

export type MarkdownMarker = 'strong' | 'emphasis' | 'code' | 'strikethrough' | 'heading';

export type MarkdownToken =
	| { kind: 'text'; text: string; styles: MarkdownStyle[] }
	| { kind: 'marker'; text: string; marker: MarkdownMarker };

export type TableAlignment = 'left' | 'center' | 'right';

export type MarkdownBlock =
	| { type: 'line'; segment: BodySegment }
	| {
			type: 'table';
			header: string[];
			alignments: TableAlignment[];
			rows: string[][];
			lineIndex: number;
	  }
	| { type: 'code'; language: string; code: string; lineIndex: number };

export type MarkdownTableSourceToken =
	{ kind: 'marker'; text: string } | { kind: 'cell'; text: string; columnIndex: number };

type MarkdownTableBlock = Extract<MarkdownBlock, { type: 'table' }>;

export type CodeToken = {
	kind: 'plain' | 'comment' | 'string' | 'flag';
	text: string;
};

type Delimiter = {
	text: string;
	marker: MarkdownMarker;
	styles: MarkdownStyle[];
	code?: boolean;
};

const STYLE_ORDER: MarkdownStyle[] = [
	'heading-1',
	'heading-2',
	'heading-3',
	'heading-4',
	'heading-5',
	'heading-6',
	'strong',
	'emphasis',
	'code',
	'strikethrough'
];

function isEscaped(source: string, index: number): boolean {
	let slashes = 0;
	for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor--) slashes++;
	return slashes % 2 === 1;
}

function isWhitespace(value: string | undefined): boolean {
	return value === undefined || /\s/.test(value);
}

function isWord(value: string | undefined): boolean {
	return !!value && /[\p{L}\p{N}_]/u.test(value);
}

function canOpen(source: string, index: number, length: number, marker: MarkdownMarker): boolean {
	if (isEscaped(source, index)) return false;
	if (marker === 'code') return true;
	if (isWhitespace(source[index + length])) return false;
	if ((marker === 'emphasis' || marker === 'strong') && source[index] === '_') {
		return !isWord(source[index - 1]) || !isWord(source[index + length]);
	}
	return true;
}

function canClose(source: string, index: number, length: number, marker: MarkdownMarker): boolean {
	if (isEscaped(source, index)) return false;
	if (marker === 'code') return true;
	if (isWhitespace(source[index - 1])) return false;
	if ((marker === 'emphasis' || marker === 'strong') && source[index] === '_') {
		return !isWord(source[index - 1]) || !isWord(source[index + length]);
	}
	return true;
}

type ParseBudget = { remaining: number };

function findClosing(
	source: string,
	start: number,
	delimiter: string,
	marker: MarkdownMarker,
	budget: ParseBudget
) {
	for (let index = start; index <= source.length - delimiter.length; index++) {
		if (--budget.remaining < 0) return -1;
		if (!source.startsWith(delimiter, index)) continue;
		let runLength = delimiter.length;
		while (source[index + runLength] === delimiter[0]) {
			if (--budget.remaining < 0) return -1;
			runLength++;
		}
		if (marker === 'code' && runLength !== delimiter.length) {
			index += runLength - 1;
			continue;
		}
		if (marker === 'emphasis' && delimiter.length === 1 && runLength > 1) {
			const afterRun = source[index + runLength];
			if (!isWhitespace(afterRun)) {
				index += runLength - 1;
				continue;
			}
		}
		const close =
			marker === 'code' || marker === 'strikethrough'
				? index
				: index + Math.max(0, runLength - delimiter.length);
		if (canClose(source, close, delimiter.length, marker)) return close;
	}
	return -1;
}

function addStyles(base: MarkdownStyle[], additions: MarkdownStyle[]): MarkdownStyle[] {
	return STYLE_ORDER.filter((style) => base.includes(style) || additions.includes(style));
}

function addText(tokens: MarkdownToken[], text: string, styles: MarkdownStyle[]) {
	if (!text) return;
	const previous = tokens.at(-1);
	if (previous?.kind === 'text' && previous.styles.join() === styles.join()) {
		previous.text += text;
		return;
	}
	tokens.push({ kind: 'text', text, styles });
}

function parseInline(
	source: string,
	inheritedStyles: MarkdownStyle[] = [],
	budget: ParseBudget = { remaining: source.length * 32 },
	depth = 0
): MarkdownToken[] {
	if (depth >= 32 || budget.remaining <= 0) {
		return source ? [{ kind: 'text', text: source, styles: inheritedStyles }] : [];
	}
	const tokens: MarkdownToken[] = [];
	let textStart = 0;
	let index = 0;

	const pushDelimited = (delimiter: Delimiter, close: number): boolean => {
		if (close <= index + delimiter.text.length) return false;
		addText(tokens, source.slice(textStart, index), inheritedStyles);
		tokens.push({ kind: 'marker', text: delimiter.text, marker: delimiter.marker });
		const contentStart = index + delimiter.text.length;
		const content = source.slice(contentStart, close);
		if (delimiter.code) {
			addText(tokens, content, addStyles(inheritedStyles, delimiter.styles));
		} else {
			tokens.push(
				...parseInline(content, addStyles(inheritedStyles, delimiter.styles), budget, depth + 1)
			);
		}
		tokens.push({ kind: 'marker', text: delimiter.text, marker: delimiter.marker });
		index = close + delimiter.text.length;
		textStart = index;
		return true;
	};

	while (index < source.length && --budget.remaining >= 0) {
		if (source[index] === '`' && !isEscaped(source, index)) {
			let length = 1;
			while (source[index + length] === '`') length++;
			const delimiter = '`'.repeat(length);
			const close = findClosing(source, index + length, delimiter, 'code', budget);
			if (
				close >= 0 &&
				pushDelimited({ text: delimiter, marker: 'code', styles: ['code'], code: true }, close)
			) {
				continue;
			}
			index += length;
			continue;
		}

		const triple = source.slice(index, index + 3);
		if ((triple === '***' || triple === '___') && canOpen(source, index, 3, 'emphasis')) {
			const close = findClosing(source, index + 3, triple, 'emphasis', budget);
			if (
				close >= 0 &&
				pushDelimited(
					{
						text: triple,
						marker: 'emphasis',
						styles: ['strong', 'emphasis']
					},
					close
				)
			) {
				continue;
			}
		}

		const candidates: Delimiter[] = [
			{ text: '~~', marker: 'strikethrough', styles: ['strikethrough'] },
			{ text: '**', marker: 'strong', styles: ['strong'] },
			{ text: '__', marker: 'strong', styles: ['strong'] },
			{ text: '*', marker: 'emphasis', styles: ['emphasis'] },
			{ text: '_', marker: 'emphasis', styles: ['emphasis'] }
		];
		let consumed = false;
		for (const delimiter of candidates) {
			if (!source.startsWith(delimiter.text, index)) continue;
			if (!canOpen(source, index, delimiter.text.length, delimiter.marker)) continue;
			const close = findClosing(
				source,
				index + delimiter.text.length,
				delimiter.text,
				delimiter.marker,
				budget
			);
			if (close >= 0 && pushDelimited(delimiter, close)) {
				consumed = true;
				break;
			}
		}
		if (consumed) continue;
		index++;
	}

	addText(tokens, source.slice(textStart), inheritedStyles);
	return tokens;
}

/**
 * Tokenize the small inline Markdown subset used by notes. Delimiters stay in
 * the token stream so raw mode can reveal them; normal mode hides them with CSS.
 */
export function parseInlineMarkdown(source: string): MarkdownToken[] {
	const heading = source.match(/^(#{1,6})[ \t]+/);
	if (!heading) return parseInline(source);
	const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
	const prefix = heading[0];
	return [
		{ kind: 'marker', text: prefix, marker: 'heading' },
		...parseInline(source.slice(prefix.length), [`heading-${level}` as MarkdownStyle])
	];
}

export function markdownTokenClass(token: MarkdownToken, rawMarkdown: boolean): string {
	if (token.kind === 'marker') {
		return `markdown-token markdown-token-marker markdown-token-marker-${token.marker}${rawMarkdown ? '' : ' markdown-token-marker-hidden'}`;
	}
	return [
		'markdown-token',
		...token.styles.map((style) => `markdown-token-${style}`),
		rawMarkdown ? 'markdown-token-raw' : ''
	]
		.filter(Boolean)
		.join(' ');
}

const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

function splitTableRow(line: string): string[] | null {
	let source = line.trim();
	if (!source.includes('|')) return null;
	if (source.startsWith('|')) source = source.slice(1);
	if (source.endsWith('|') && !isEscaped(source, source.length - 1)) {
		source = source.slice(0, -1);
	}

	const cells: string[] = [];
	let cell = '';
	let codeDelimiterLength = 0;
	for (let index = 0; index < source.length; index++) {
		const character = source[index];
		if (character === '\\' && source[index + 1] === '|') {
			cell += '|';
			index++;
			continue;
		}
		if (character === '`') {
			let runLength = 1;
			while (source[index + runLength] === '`') runLength++;
			if (codeDelimiterLength === 0) codeDelimiterLength = runLength;
			else if (codeDelimiterLength === runLength) codeDelimiterLength = 0;
			cell += '`'.repeat(runLength);
			index += runLength - 1;
			continue;
		}
		if (character === '|' && codeDelimiterLength === 0) {
			cells.push(cell.trim());
			cell = '';
			continue;
		}
		cell += character;
	}
	cells.push(cell.trim());
	return cells.length >= 2 ? cells : null;
}

/** Keep a table source row intact while separating visible cells from Markdown delimiters. */
export function tokenizeMarkdownTableRow(source: string): MarkdownTableSourceToken[] {
	const pipes: number[] = [];
	let codeDelimiterLength = 0;
	for (let index = 0; index < source.length; index++) {
		if (source[index] === '`') {
			let runLength = 1;
			while (source[index + runLength] === '`') runLength++;
			if (codeDelimiterLength === 0) codeDelimiterLength = runLength;
			else if (codeDelimiterLength === runLength) codeDelimiterLength = 0;
			index += runLength - 1;
			continue;
		}
		if (source[index] === '|' && codeDelimiterLength === 0 && !isEscaped(source, index)) {
			pipes.push(index);
		}
	}

	if (pipes.length === 0) return [{ kind: 'cell', text: source, columnIndex: 0 }];
	const tokens: MarkdownTableSourceToken[] = [];
	let start = 0;
	let columnIndex = 0;
	const appendSegment = (text: string, outside: boolean) => {
		if (outside) {
			if (text) tokens.push({ kind: 'marker', text });
			return;
		}
		// An empty cell's caret sits one space after its opening pipe, not after the padding.
		const leading = text.trim() ? (text.match(/^\s*/)?.[0] ?? '') : text.slice(0, 1);
		const trailing = text.slice(leading.length).match(/\s*$/)?.[0] ?? '';
		const cell = text.slice(leading.length, text.length - trailing.length);
		if (leading) tokens.push({ kind: 'marker', text: leading });
		tokens.push({ kind: 'cell', text: cell, columnIndex });
		columnIndex++;
		if (trailing) tokens.push({ kind: 'marker', text: trailing });
	};

	for (let pipeIndex = 0; pipeIndex < pipes.length; pipeIndex++) {
		const pipe = pipes[pipeIndex];
		const segment = source.slice(start, pipe);
		appendSegment(segment, pipeIndex === 0 && segment.trim() === '');
		tokens.push({ kind: 'marker', text: '|' });
		start = pipe + 1;
	}
	const trailing = source.slice(start);
	appendSegment(trailing, trailing.trim() === '');
	return tokens;
}

/** Source text of each cell in a table row, with Markdown escapes intact. */
export function markdownTableCells(source: string): string[] {
	return tokenizeMarkdownTableRow(source).flatMap((token) =>
		token.kind === 'cell' ? [token.text] : []
	);
}

/** Character ranges of each cell's content within a table row. */
export function markdownTableCellRanges(source: string): { start: number; end: number }[] {
	const ranges: { start: number; end: number }[] = [];
	let offset = 0;
	for (const token of tokenizeMarkdownTableRow(source)) {
		if (token.kind === 'cell') ranges.push({ start: offset, end: offset + token.text.length });
		offset += token.text.length;
	}
	return ranges;
}

/** A pipe-delimited row with at least two cells that could head a new table. */
export function isMarkdownTableHeaderRow(source: string): boolean {
	const trimmed = source.trim();
	return (
		trimmed.startsWith('|') &&
		trimmed.endsWith('|') &&
		!isEscaped(trimmed, trimmed.length - 1) &&
		markdownTableCells(source).length >= 2
	);
}

export function emptyMarkdownTableRow(columns: number): string {
	return `|${'  |'.repeat(columns)}`;
}

export function markdownTableDelimiterRow(columns: number): string {
	return `|${' --- |'.repeat(columns)}`;
}

function delimiterAlignment(cell: string): 'l' | 'c' | 'r' | '' {
	const value = cell.trim();
	const left = value.startsWith(':');
	const right = value.length > 1 && value.endsWith(':');
	if (left && right) return 'c';
	if (right) return 'r';
	return left ? 'l' : '';
}

/**
 * Pretty-print a GFM table (header, delimiter, body rows): every column is
 * padded to its widest cell, measured in terminal columns so emoji and CJK
 * text line up in monospace, and the delimiter row is filled with dashes.
 */
export function formatMarkdownTable(rows: readonly string[]): string[] {
	const [header = '', delimiter = '', ...body] = rows;
	const indent = header.match(/^[ \t]*/)?.[0] ?? '';
	return markdownTable([markdownTableCells(header), ...body.map(markdownTableCells)], {
		align: markdownTableCells(delimiter).map(delimiterAlignment),
		stringLength: stringWidth
	})
		.split('\n')
		.map((line) => indent + line);
}

function tableAlignment(cell: string): TableAlignment | null {
	const value = cell.trim();
	if (!/^:?-{1,}:?$/.test(value)) return null;
	if (value.startsWith(':') && value.endsWith(':')) return 'center';
	if (value.endsWith(':')) return 'right';
	return 'left';
}

function tableAt(lines: string[], lineIndex: number): MarkdownTableBlock | null {
	const header = splitTableRow(lines[lineIndex] ?? '');
	const separator = splitTableRow(lines[lineIndex + 1] ?? '');
	if (!header || !separator || header.length !== separator.length) return null;
	const alignments = separator.map(tableAlignment);
	if (alignments.some((alignment) => alignment === null)) return null;

	const rows: string[][] = [];
	let nextLine = lineIndex + 2;
	while (nextLine < lines.length) {
		if (lines[nextLine]?.trim() === '') break;
		const cells = splitTableRow(lines[nextLine] ?? '');
		if (!cells) break;
		rows.push(header.map((_, columnIndex) => cells[columnIndex] ?? ''));
		nextLine++;
	}

	return {
		type: 'table',
		header,
		alignments: alignments as TableAlignment[],
		rows,
		lineIndex
	};
}

function fenceAt(line: string): { indent: number; marker: string; info: string } | null {
	const match = line.match(FENCE_OPEN_RE);
	if (!match || (match[2]?.startsWith('`') && match[3]?.includes('`'))) return null;
	return { indent: match[1]?.length ?? 0, marker: match[2] ?? '', info: match[3]?.trim() ?? '' };
}

function isFenceClose(line: string, opening: string): boolean {
	const match = line.match(FENCE_CLOSE_RE);
	return match?.[1]?.[0] === opening[0] && (match[1]?.length ?? 0) >= opening.length;
}

/** Parse fenced code and GitHub-style table blocks without changing raw text. */
export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
	const lines = source.replace(/\r\n?/g, '\n').split('\n');
	const blocks: MarkdownBlock[] = [];
	let lineIndex = 0;

	while (lineIndex < lines.length) {
		const opening = fenceAt(lines[lineIndex] ?? '');
		if (opening) {
			const codeLines: string[] = [];
			let nextLine = lineIndex + 1;
			while (nextLine < lines.length && !isFenceClose(lines[nextLine] ?? '', opening.marker)) {
				const line = lines[nextLine] ?? '';
				codeLines.push(
					opening.indent > 0 && line.startsWith(' '.repeat(opening.indent))
						? line.slice(opening.indent)
						: line
				);
				nextLine++;
			}
			blocks.push({
				type: 'code',
				language: opening.info.split(/[ \t]+/, 1)[0] ?? '',
				code: codeLines.join('\n'),
				lineIndex
			});
			lineIndex = nextLine < lines.length ? nextLine + 1 : nextLine;
			continue;
		}

		const table = tableAt(lines, lineIndex);
		if (table) {
			blocks.push(table);
			lineIndex += 2 + table.rows.length;
			continue;
		}

		const segment = parseBody(lines[lineIndex] ?? '')[0];
		if (segment) blocks.push({ type: 'line', segment: { ...segment, lineIndex } });
		lineIndex++;
	}

	return blocks;
}

function addCodeToken(tokens: CodeToken[], text: string, kind: CodeToken['kind'] = 'plain') {
	if (!text) return;
	const previous = tokens.at(-1);
	if (previous?.kind === kind) {
		previous.text += text;
		return;
	}
	tokens.push({ kind, text });
}

function tokenizeCodeText(source: string): CodeToken[] {
	const tokens: CodeToken[] = [];
	const tokenRe = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|--[A-Za-z][\w-]*)/gu;
	let textStart = 0;
	for (const match of source.matchAll(tokenRe)) {
		const index = match.index ?? 0;
		addCodeToken(tokens, source.slice(textStart, index));
		const value = match[0] ?? '';
		addCodeToken(tokens, value, value.startsWith('--') ? 'flag' : 'string');
		textStart = index + value.length;
	}
	addCodeToken(tokens, source.slice(textStart));
	return tokens;
}

function codeCommentStart(source: string, language: string): number {
	const trimmedStart = source.search(/\S/);
	if (trimmedStart >= 0 && source[trimmedStart] === '#') return trimmedStart;
	if (trimmedStart >= 0 && source.startsWith('//', trimmedStart)) return trimmedStart;
	if (trimmedStart >= 0 && source.startsWith('<!--', trimmedStart)) return trimmedStart;
	if (['sh', 'shell', 'bash', 'zsh'].includes(language.toLowerCase())) {
		let quote: string | null = null;
		for (let index = 0; index < source.length; index++) {
			const character = source[index];
			if ((character === '"' || character === "'") && source[index - 1] !== '\\') {
				quote = quote === character ? null : (quote ?? character);
			}
			if (character === '#' && quote === null && source[index - 1] !== '\\') return index;
		}
	}
	return -1;
}

/** Add restrained syntax color to common code-block strings, flags, and comments. */
export function highlightCodeLine(source: string, language = ''): CodeToken[] {
	const commentStart = codeCommentStart(source, language);
	if (commentStart < 0) return tokenizeCodeText(source);
	const tokens = tokenizeCodeText(source.slice(0, commentStart));
	addCodeToken(tokens, source.slice(commentStart), 'comment');
	return tokens;
}
