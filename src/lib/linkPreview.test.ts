import { describe, expect, it } from 'vitest';
import {
	extractHttpUrls,
	joinWrappedHttpUrls,
	localLinkCard,
	normalizePreviewUrl
} from './linkPreview';

describe('extractHttpUrls', () => {
	it('returns distinct HTTP(S) links in their note order', () => {
		expect(
			extractHttpUrls(
				'Read https://example.com/a then http://example.org/b. Again: https://example.com/a'
			)
		).toEqual(['https://example.com/a', 'http://example.org/b']);
	});

	it('does not treat checklist syntax or bare domains as previews', () => {
		expect(extractHttpUrls('[ ] example.com\n[x] https://docs.example.com/guide')).toEqual([
			'https://docs.example.com/guide'
		]);
	});

	it('does not cap the number of distinct links', () => {
		const body = [1, 2, 3, 4, 5].map((n) => `https://example.com/${n}`).join('\n');
		expect(extractHttpUrls(body)).toHaveLength(5);
	});
});

describe('joinWrappedHttpUrls', () => {
	it('joins a query a paste wrapped onto the next line', () => {
		const wrapped =
			'what ever https://naysbaits.com/en-eu?\n_su_rec=Sn1GDAHB&__su_rec_id=9c3ebfa2-b7a6-43ba-b09b';
		expect(joinWrappedHttpUrls(wrapped)).toBe(
			'what ever https://naysbaits.com/en-eu?_su_rec=Sn1GDAHB&__su_rec_id=9c3ebfa2-b7a6-43ba-b09b'
		);
		expect(extractHttpUrls(wrapped)).toEqual([
			'https://naysbaits.com/en-eu?_su_rec=Sn1GDAHB&__su_rec_id=9c3ebfa2-b7a6-43ba-b09b'
		]);
	});

	it('joins a wrapped URL that is itself a checklist item', () => {
		expect(joinWrappedHttpUrls('[ ] https://shop.example/item?\n_id=abc')).toBe(
			'[ ] https://shop.example/item?_id=abc'
		);
	});

	it('does not join a URL wrapped on purpose inside a code fence', () => {
		const fenced = [
			'```bash',
			'curl https://api.example.com/x?',
			'_token=abcdefghijklmnopqrstuvwxyz0123456789',
			'```',
			'~~~',
			'curl https://api.example.com/y?',
			'_token=abc',
			'~~~',
			'https://shop.example/item?',
			'_id=abc'
		].join('\n');
		expect(joinWrappedHttpUrls(fenced)).toBe(
			[
				'```bash',
				'curl https://api.example.com/x?',
				'_token=abcdefghijklmnopqrstuvwxyz0123456789',
				'```',
				'~~~',
				'curl https://api.example.com/y?',
				'_token=abc',
				'~~~',
				'https://shop.example/item?_id=abc'
			].join('\n')
		);
	});

	it('does not join a long token line that merely contains an equals sign', () => {
		const body = [
			'https://example.com/done',
			'token=abcdefghijklmnopqrstuvwxyz0123456789abcdef'
		].join('\n');
		expect(joinWrappedHttpUrls(body)).toBe(body);
	});

	it('leaves a following word, a new link, and a checklist row alone', () => {
		const body = [
			'https://hevisleep.sk/products/hevi-blanket?variant=48393585066197',
			'sublera',
			'https://example.com/a',
			'https://example.com/b',
			'[ ] https://example.com/done?',
			'[ ] next item'
		].join('\n');
		expect(joinWrappedHttpUrls(body)).toBe(body);
	});
});

describe('normalizePreviewUrl', () => {
	it('strips hash but keeps path so pages stay distinct', () => {
		expect(normalizePreviewUrl('https://github.com/org/repo#readme')).toBe(
			'https://github.com/org/repo'
		);
		expect(normalizePreviewUrl('https://github.com/org/other')).toBe(
			'https://github.com/org/other'
		);
	});
});

describe('localLinkCard', () => {
	it('derives a useful card without fetching remote metadata', () => {
		expect(localLinkCard('https://www.github.com/org/my-project?tab=readme#top')).toEqual({
			url: 'https://www.github.com/org/my-project?tab=readme',
			hostname: 'github.com',
			title: 'My project',
			address: 'github.com/org/my-project?tab=readme'
		});
	});

	it.each([
		[
			'https://blog.example.com/posts/how-to-build-offline-first-apps',
			'How to build offline first apps'
		],
		['https://en.wikipedia.org/wiki/Black_swan_theory', 'Black swan theory'],
		['https://de.wikipedia.org/wiki/K%C3%B6ln', 'Köln'],
		['https://example.com/docs/getting_started.html', 'Getting started'],
		['https://example.com/guide/quick-start', 'Quick start'],
		['https://example.com/p/9f86d081884c7d659a2f', 'example.com'],
		['https://example.com/', 'example.com'],
		['https://example.com/12345', 'example.com']
	])('reads a generic title for %s from URL slugs alone', (url, title) => {
		expect(localLinkCard(url)?.title).toBe(title);
	});
});
