import { describe, expect, it } from 'vitest';
import {
	formatMarkdownTable,
	highlightCodeLine,
	isMarkdownTableHeaderRow,
	markdownTableCellRanges,
	markdownTokenClass,
	parseInlineMarkdown,
	parseMarkdownBlocks,
	tokenizeMarkdownTableRow
} from './markdown';

describe('inline Markdown tokenizer', () => {
	it('recognizes classic strong, emphasis, code, and strikethrough delimiters', () => {
		const tokens = parseInlineMarkdown('**bold** *italic* `code` ~~removed~~');

		expect(tokens.filter((token) => token.kind === 'marker').map((token) => token.text)).toEqual([
			'**',
			'**',
			'*',
			'*',
			'`',
			'`',
			'~~',
			'~~'
		]);
		expect(
			tokens.filter((token) => token.kind === 'text').map((token) => [token.text, token.styles])
		).toEqual([
			['bold', ['strong']],
			[' ', []],
			['italic', ['emphasis']],
			[' ', []],
			['code', ['code']],
			[' ', []],
			['removed', ['strikethrough']]
		]);
	});

	it('keeps Markdown-looking text literal inside code spans', () => {
		const tokens = parseInlineMarkdown('``**not bold** ~~not removed~~``');
		const text = tokens.filter((token) => token.kind === 'text');

		expect(text).toHaveLength(1);
		expect(text[0]).toMatchObject({
			text: '**not bold** ~~not removed~~',
			styles: ['code']
		});
	});

	it('supports nested and heading styles', () => {
		const tokens = parseInlineMarkdown('## ***bold italic***');

		expect(tokens[0]).toMatchObject({ kind: 'marker', text: '## ', marker: 'heading' });
		expect(tokens.filter((token) => token.kind === 'marker').map((token) => token.text)).toEqual([
			'## ',
			'***',
			'***'
		]);
		expect(tokens[2]).toMatchObject({
			kind: 'text',
			text: 'bold italic',
			styles: ['heading-2', 'strong', 'emphasis']
		});
	});

	it('supports emphasis nested inside strong text', () => {
		const tokens = parseInlineMarkdown('**bold *and italic***');

		expect(tokens).toContainEqual({
			kind: 'text',
			text: 'and italic',
			styles: ['strong', 'emphasis']
		});
	});

	it('supports strong nested inside emphasis text', () => {
		const tokens = parseInlineMarkdown('*italic **and bold***');

		expect(tokens).toContainEqual({
			kind: 'text',
			text: 'and bold',
			styles: ['strong', 'emphasis']
		});
	});

	it('hides delimiters only outside raw Markdown mode', () => {
		const marker = parseInlineMarkdown('**bold**').find((token) => token.kind === 'marker');
		if (!marker) throw new Error('Expected a marker token');

		expect(markdownTokenClass(marker, false)).toContain('markdown-token-marker-hidden');
		expect(markdownTokenClass(marker, true)).not.toContain('markdown-token-marker-hidden');
	});

	it('leaves escaped, malformed, and word-internal delimiters literal', () => {
		for (const source of ['\\*literal\\*', '**unclosed', 'foo_bar_baz']) {
			const tokens = parseInlineMarkdown(source);
			expect(tokens).toEqual([{ kind: 'text', text: source, styles: [] }]);
		}
	});

	it('handles code-span whitespace and Unicode text', () => {
		const code = parseInlineMarkdown('` code `');
		expect(code.find((token) => token.kind === 'text')).toMatchObject({
			text: ' code ',
			styles: ['code']
		});
		expect(parseInlineMarkdown('__привет__')).toContainEqual({
			kind: 'text',
			text: 'привет',
			styles: ['strong']
		});
	});
});

describe('Markdown block tokenizer', () => {
	it('separates table cells without changing their raw source', () => {
		const source = '| Rule name | starts with `/api/sync/auth/` |';
		const tokens = tokenizeMarkdownTableRow(source);

		expect(tokens.map((token) => token.text).join('')).toBe(source);
		expect(tokens.filter((token) => token.kind === 'cell')).toEqual([
			{ kind: 'cell', text: 'Rule name', columnIndex: 0 },
			{ kind: 'cell', text: 'starts with `/api/sync/auth/`', columnIndex: 1 }
		]);
	});

	it('does not split escaped or inline-code pipes into extra columns', () => {
		const source = '| escaped \\| pipe | `left|right` |';
		const tokens = tokenizeMarkdownTableRow(source);

		expect(tokens.map((token) => token.text).join('')).toBe(source);
		expect(tokens.filter((token) => token.kind === 'cell')).toEqual([
			{ kind: 'cell', text: 'escaped \\| pipe', columnIndex: 0 },
			{ kind: 'cell', text: '`left|right`', columnIndex: 1 }
		]);
	});

	it('recognizes tables and their column alignments', () => {
		expect(
			parseMarkdownBlocks(
				[
					'Before',
					'',
					'| Rule name | Matches path | Limit |',
					'| :--- | :---: | ---: |',
					'| register | `/api/sync/register` | 5 per hour |',
					'| auth | starts with `/api/sync/auth/` | 30 per minute |',
					'',
					'After'
				].join('\n')
			)
		).toEqual([
			{ type: 'line', segment: { type: 'text', text: 'Before', lineIndex: 0 } },
			{ type: 'line', segment: { type: 'text', text: '', lineIndex: 1 } },
			{
				type: 'table',
				header: ['Rule name', 'Matches path', 'Limit'],
				alignments: ['left', 'center', 'right'],
				rows: [
					['register', '`/api/sync/register`', '5 per hour'],
					['auth', 'starts with `/api/sync/auth/`', '30 per minute']
				],
				lineIndex: 2
			},
			{ type: 'line', segment: { type: 'text', text: '', lineIndex: 6 } },
			{ type: 'line', segment: { type: 'text', text: 'After', lineIndex: 7 } }
		]);
	});

	it('keeps fenced code together and protects table-looking code', () => {
		expect(
			parseMarkdownBlocks(
				['```sh', '# comment', 'echo "| not a table |"', '```', 'after'].join('\n')
			)
		).toEqual([
			{ type: 'code', language: 'sh', code: '# comment\necho "| not a table |"', lineIndex: 0 },
			{ type: 'line', segment: { type: 'text', text: 'after', lineIndex: 4 } }
		]);
	});

	it('supports an unclosed fence without losing its source', () => {
		expect(parseMarkdownBlocks('```text\nnot closed')).toEqual([
			{ type: 'code', language: 'text', code: 'not closed', lineIndex: 0 }
		]);
	});

	it('does not turn malformed separators into tables and respects escaped pipes', () => {
		const malformed = parseMarkdownBlocks('| A | B |\n| - | no |');
		expect(malformed.every((block) => block.type === 'line')).toBe(true);

		const escapedPipe = parseMarkdownBlocks(
			'| A | B |\n| --- | --- |\n| one \\| two | `three | four` |'
		);
		expect(escapedPipe).toContainEqual({
			type: 'table',
			header: ['A', 'B'],
			alignments: ['left', 'left'],
			rows: [['one | two', '`three | four`']],
			lineIndex: 0
		});
	});
});

describe('code block tokenizer', () => {
	it('colors comments, flags, and quoted strings while preserving text', () => {
		expect(highlightCodeLine('# Reads the VAPID pair', 'sh')).toEqual([
			{ kind: 'comment', text: '# Reads the VAPID pair' }
		]);
		expect(highlightCodeLine('wrangler d1 --remote --command "SELECT 1"', 'sh')).toEqual([
			{ kind: 'plain', text: 'wrangler d1 ' },
			{ kind: 'flag', text: '--remote' },
			{ kind: 'plain', text: ' ' },
			{ kind: 'flag', text: '--command' },
			{ kind: 'plain', text: ' ' },
			{ kind: 'string', text: '"SELECT 1"' }
		]);
	});
});

describe('Markdown table formatting', () => {
	it('pads columns, fills the delimiter row, and keeps alignment markers', () => {
		expect(
			formatMarkdownTable([
				'| Tables | Are | Cool |',
				'|----------|:-------------:|------:|',
				'| col 1 is | left-aligned | $1600 |',
				'| col 3 is | right-aligned | $1 |'
			])
		).toEqual([
			'| Tables   |      Are      |  Cool |',
			'| -------- | :-----------: | ----: |',
			'| col 1 is |  left-aligned | $1600 |',
			'| col 3 is | right-aligned |    $1 |'
		]);
	});

	it('aligns emoji by display width and keeps escaped pipes and code spans intact', () => {
		const formatted = formatMarkdownTable([
			'| Service | Status | Note |',
			'| :-- | :-: | --- |',
			'| API | 🟢 Up | `a|b` |',
			'| Cache | 🟡 Slow | x \\| y |'
		]);

		expect(formatted).toEqual([
			'| Service |  Status | Note   |',
			'| :------ | :-----: | ------ |',
			'| API     |  🟢 Up  | `a|b`  |',
			'| Cache   | 🟡 Slow | x \\| y |'
		]);
		expect(parseMarkdownBlocks(formatted.join('\n'))[0]?.type).toBe('table');
	});

	it('keeps cells from ragged rows instead of dropping them', () => {
		expect(formatMarkdownTable(['| a | b |', '| - | - |', '| 1 |', '| 1 | 2 | 3 |'])).toEqual([
			'| a | b |   |',
			'| - | - | - |',
			'| 1 |   |   |',
			'| 1 | 2 | 3 |'
		]);
	});

	it('locates cell content for caret placement', () => {
		const row = '| ab | c  |';
		expect(markdownTableCellRanges(row).map(({ start, end }) => row.slice(start, end))).toEqual([
			'ab',
			'c'
		]);
	});

	it('only treats a closed pipe row with two cells as a table header', () => {
		expect(isMarkdownTableHeaderRow('| Name | Status |')).toBe(true);
		expect(isMarkdownTableHeaderRow('| Name |')).toBe(false);
		expect(isMarkdownTableHeaderRow('a | b')).toBe(false);
	});
});
