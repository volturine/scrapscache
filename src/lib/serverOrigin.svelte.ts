import { isNativeApp } from './native.js';

/** Where the iPhone app syncs unless the user names another server. */
export const DEFAULT_SERVER_ORIGIN = 'https://scrapscache.com';
const LS_KEY = 'scrapscache-server';

/**
 * An https origin and nothing more: no path, query, fragment or credentials. A
 * bare host is taken as https. The web app never calls this; it talks to the
 * origin it was loaded from.
 */
export function normalizeServerOrigin(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	let url: URL;
	try {
		url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.username || url.password) return null;
	if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return null;
	return url.origin;
}

function readStored(): string {
	try {
		const stored = localStorage.getItem(LS_KEY);
		return (stored && normalizeServerOrigin(stored)) || DEFAULT_SERVER_ORIGIN;
	} catch {
		return DEFAULT_SERVER_ORIGIN;
	}
}

let origin = $state(readStored());

/** The server setting, as Settings shows and changes it. */
export const serverSetting = {
	get origin(): string {
		return origin;
	},
	get isDefault(): boolean {
		return origin === DEFAULT_SERVER_ORIGIN;
	},
	/** Keeps the value if it is a usable origin; says whether it was. */
	set(value: string): boolean {
		const next = normalizeServerOrigin(value);
		if (!next) return false;
		origin = next;
		try {
			if (next === DEFAULT_SERVER_ORIGIN) localStorage.removeItem(LS_KEY);
			else localStorage.setItem(LS_KEY, next);
		} catch {
			// Kept for this session only.
		}
		return true;
	}
};

/** The server's origin inside the app; null on the web, where paths are relative. */
export function serverOrigin(): string | null {
	return isNativeApp() ? origin : null;
}

/** An API path as this build should fetch it. */
export function serverUrl(path: string): string {
	const base = serverOrigin();
	return base ? `${base}${path}` : path;
}

/** The origin links handed out from here (sharing, pairing) should open: the web app. */
export function appLinkOrigin(): string {
	return serverOrigin() ?? location.origin;
}

/** The page a pairing link points at: this page on the web, the web app's home in the app. */
export function appLinkBase(): string {
	const base = serverOrigin();
	return base ? `${base}/` : location.href;
}
