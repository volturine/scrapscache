import { describe, expect, it } from 'vitest';
import { extractHttpUrls, localLinkCard, normalizePreviewUrl } from './linkPreview';

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
