import { describe, expect, it } from 'vitest';
import { siGithub, siGoogle, siGoogledocs, siWikipedia } from 'simple-icons';
import { siteIcon } from './siteIcons';

describe('siteIcon', () => {
	it('matches a listed domain and its subdomains', () => {
		expect(siteIcon('github.com')).toBe(siGithub);
		expect(siteIcon('gist.github.com')).toBe(siGithub);
		expect(siteIcon('en.wikipedia.org')).toBe(siWikipedia);
	});

	it('prefers the most specific listed domain', () => {
		expect(siteIcon('docs.google.com')).toBe(siGoogledocs);
		expect(siteIcon('www.google.com')).toBe(siGoogle);
	});

	it('leaves unknown sites to the monogram badge', () => {
		expect(siteIcon('example.com')).toBeUndefined();
		// A bare TLD never matches a listed domain.
		expect(siteIcon('com')).toBeUndefined();
		expect(siteIcon('notgithub.com')).toBeUndefined();
	});
});
