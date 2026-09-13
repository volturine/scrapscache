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

function findClosing(source: string, start: number, delimiter: string, marker: MarkdownMarker) {
	for (let index = start; index <= source.length - delimiter.length; index++) {
		if (!source.startsWith(delimiter, index)) continue;
		let runLength = delimiter.length;
		while (source[index + runLength] === delimiter[0]) runLength++;
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

function parseInline(source: string, inheritedStyles: MarkdownStyle[] = []): MarkdownToken[] {
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
			tokens.push(...parseInline(content, addStyles(inheritedStyles, delimiter.styles)));
		}
		tokens.push({ kind: 'marker', text: delimiter.text, marker: delimiter.marker });
		index = close + delimiter.text.length;
		textStart = index;
		return true;
	};

	while (index < source.length) {
		if (source[index] === '`' && !isEscaped(source, index)) {
			let length = 1;
			while (source[index + length] === '`') length++;
			const delimiter = '`'.repeat(length);
			const close = findClosing(source, index + length, delimiter, 'code');
			if (
				close >= 0 &&
				pushDelimited({ text: delimiter, marker: 'code', styles: ['code'], code: true }, close)
			) {
				continue;
			}
		}

		const triple = source.slice(index, index + 3);
		if ((triple === '***' || triple === '___') && canOpen(source, index, 3, 'emphasis')) {
			const close = findClosing(source, index + 3, triple, 'emphasis');
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
				delimiter.marker
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
