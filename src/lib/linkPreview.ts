const HTTP_URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

import type { LinkPreview, NoteColor } from './model/types';

export type { LinkPreview };

export type LocalLinkCard = {
	url: string;
	hostname: string;
	/** Readable name read from the URL's shape; the hostname when the path says nothing. */
	title: string;
	/** Hostname and path without the scheme, for the secondary line. */
	address: string;
	badge: string;
	/** Stable per-site tint for the monogram badge. */
	tone: Exclude<NoteColor, 'default'>;
};

const TONES: LocalLinkCard['tone'][] = [
	'red',
	'orange',
	'yellow',
	'green',
	'teal',
	'blue',
	'darkblue',
	'purple',
	'pink',
	'brown',
	'gray'
];

function cleanUrl(raw: string): string {
	return raw.replace(/[.,!?;:]+$/, '').replace(/\)+$/, '');
}

/** Stable cache key for a link (strip hash; keep path/query so pages differ). */
export function normalizePreviewUrl(value: string): string | null {
	try {
		const url = new URL(value);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		url.hash = '';
		return url.href;
	} catch {
		return null;
	}
}

/** Returns unique HTTP(S) URLs in the order they appear in a note. */
export function extractHttpUrls(text: string): string[] {
	const urls: string[] = [];
	const seen = new Set<string>();

	for (const match of text.matchAll(HTTP_URL_RE)) {
		const value = cleanUrl(match[0]);
		const href = normalizePreviewUrl(value);
		if (!href || seen.has(href)) continue;
		seen.add(href);
		urls.push(href);
	}

	return urls;
}

function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/** Turns a URL slug into words, or null when it looks like an ID rather than a name. */
function slugWords(segment: string): string | null {
	const words = decodeSegment(segment)
		.replace(/\.[a-z0-9]{1,5}$/i, '')
		.replace(/[-_+]+/g, ' ')
		.trim();
	// Too short to name anything ("p", "en"), or no letters at all.
	if (words.length < 3 || !/\p{L}/u.test(words)) return null;
	// Opaque IDs: long runs without spaces that mix letters and digits.
	if (!words.includes(' ') && /\d/.test(words) && words.length > 8) return null;
	if (/^(index|default|home)$/i.test(words)) return null;
	return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

function siteTitle(host: string, parts: string[], url: URL): string | null {
	const [first, second, third, fourth] = parts;
	if (host === 'github.com' && first) {
		if (!second) return first;
		const repo = `${first}/${second}`;
		if (third === 'pull' && fourth) return `${repo} · PR #${fourth}`;
		if (third === 'issues' && fourth) return `${repo} · Issue #${fourth}`;
		if (third === 'discussions' && fourth) return `${repo} · Discussion #${fourth}`;
		if (third === 'releases') return `${repo} · Releases`;
		return repo;
	}
	if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
		if (first?.startsWith('@')) return first;
		if (first === 'playlist') return 'YouTube playlist';
		if (first === 'shorts') return 'YouTube short';
		if (host === 'youtu.be' || url.searchParams.has('v')) return 'YouTube video';
		return null;
	}
	if ((host === 'wikipedia.org' || host.endsWith('.wikipedia.org')) && first === 'wiki' && second) {
		return decodeSegment(second).replace(/_/g, ' ');
	}
	if (host === 'reddit.com' || host === 'old.reddit.com') {
		if (first !== 'r' || !second) return null;
		if (third === 'comments' && parts[4]) {
			const post = slugWords(parts[4]);
			return post ? `${post} · r/${second}` : `r/${second}`;
		}
		return `r/${second}`;
	}
	if ((host === 'x.com' || host === 'twitter.com') && first) {
		return second === 'status' ? `Post by @${first}` : `@${first}`;
	}
	if (host === 'news.ycombinator.com' && first === 'item') return 'Hacker News thread';
	return null;
}

/** Best local guess at what a link points to, read from its path alone. */
function readableTitle(host: string, url: URL): string {
	const parts = url.pathname.split('/').filter(Boolean);
	const known = siteTitle(host, parts, url);
	if (known) return known;
	for (const segment of parts.toReversed()) {
		const words = slugWords(segment);
		if (words) return words;
	}
	return host;
}

/** The label that names the site: "example" for blog.example.com or example.co.uk. */
function siteName(host: string): string {
	const labels = host.split('.').filter(Boolean);
	if (labels.length < 2) return host;
	const [second, top] = labels.slice(-2) as [string, string];
	// Short second-level labels under a country code (co.uk, com.au) are not the name.
	if (labels.length > 2 && top.length === 2 && second.length <= 3) return labels.at(-3)!;
	return second;
}

function toneFor(site: string): LocalLinkCard['tone'] {
	let hash = 0;
	for (const char of site) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
	return TONES[hash % TONES.length]!;
}

/** Build a deterministic card from the URL alone. This function never performs I/O. */
export function localLinkCard(value: string): LocalLinkCard | null {
	const normalized = normalizePreviewUrl(value);
	if (!normalized) return null;
	const parsed = new URL(normalized);
	const hostname = parsed.hostname.replace(/^www\./i, '');
	const pathAndQuery = `${parsed.pathname}${parsed.search}`;
	const site = siteName(hostname);
	return {
		url: normalized,
		hostname,
		title: readableTitle(hostname, parsed),
		address: pathAndQuery === '/' ? hostname : `${hostname}${pathAndQuery}`,
		badge: Array.from(site)[0]?.toLocaleUpperCase() || '↗',
		tone: toneFor(site)
	};
}
