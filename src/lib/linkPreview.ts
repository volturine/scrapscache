const HTTP_URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

import type { LinkPreview } from './model/types';

export type { LinkPreview };

export type LocalLinkCard = {
	url: string;
	hostname: string;
	/** Readable name read from the URL's shape; the hostname when the path says nothing. */
	title: string;
	/** Hostname and path without the scheme, for the secondary line. */
	address: string;
};

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

/** Best local guess at what a link points to, read from its path alone. */
function readableTitle(host: string, url: URL): string {
	const parts = url.pathname.split('/').filter(Boolean);
	for (const segment of parts.toReversed()) {
		const words = slugWords(segment);
		if (words) return words;
	}
	return host;
}

/** Build a deterministic card from the URL alone. This function never performs I/O. */
export function localLinkCard(value: string): LocalLinkCard | null {
	const normalized = normalizePreviewUrl(value);
	if (!normalized) return null;
	const parsed = new URL(normalized);
	const hostname = parsed.hostname.replace(/^www\./i, '');
	const pathAndQuery = `${parsed.pathname}${parsed.search}`;
	return {
		url: normalized,
		hostname,
		title: readableTitle(hostname, parsed),
		address: pathAndQuery === '/' ? hostname : `${hostname}${pathAndQuery}`
	};
}
