import { isNativeApp } from './native.js';
import { serverUrl } from './serverOrigin.svelte.js';

/** The challenge origins this build may frame in the iPhone app (vite.config.ts). */
const APP_CHALLENGE_ORIGINS: readonly string[] = __APP_CHALLENGE_ORIGINS__;

/**
 * What the sync server asks for before it registers an account:
 * - `none`: no human check;
 * - `check`: a Turnstile token from the challenge page on `origin`;
 * - `unsupported`: a check the iPhone app cannot frame, because only the
 *   hosted servers' challenge origins are allowed there;
 * - `unknown`: the server could not be asked, so whether it wants one is not known.
 */
export type TurnstileNeed =
	| { kind: 'none' }
	| { kind: 'check'; origin: string }
	| { kind: 'unsupported'; origin: string }
	| { kind: 'unknown' };

/** An http(s) origin and nothing more, as browsers write it; null for anything else. */
function bareOrigin(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
	if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
	return url.origin;
}

/**
 * Ask the sync server whether registering needs a Turnstile token. Asked of the
 * server itself, because the iPhone app can sync with any server and its build
 * cannot know which one asks for what.
 */
export async function loadTurnstileNeed(
	fetchImpl: typeof fetch = fetch,
	timeoutMs = 8_000
): Promise<TurnstileNeed> {
	let data: unknown;
	try {
		const response = await fetchImpl(serverUrl('/api/sync/register'), {
			cache: 'no-store',
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (!response.ok) return { kind: 'unknown' };
		data = await response.json();
	} catch {
		return { kind: 'unknown' };
	}
	const value = (data as { turnstileOrigin?: unknown } | null)?.turnstileOrigin;
	if (value === null) return { kind: 'none' };
	const origin = bareOrigin(value);
	if (!origin) return { kind: 'unknown' };
	if (isNativeApp() && !APP_CHALLENGE_ORIGINS.includes(origin))
		return { kind: 'unsupported', origin };
	return { kind: 'check', origin };
}
