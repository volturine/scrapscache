import { describe, expect, it } from 'vitest';
import { markdownTokenClass, parseInlineMarkdown } from './markdown';

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
