import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;
const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

export type TurnstileResult = 'disabled' | 'verified' | 'rejected' | 'misconfigured';

/**
 * Where the Turnstile widget runs, and the app it answers to.
 *
 * Turnstile's script is third-party code. Anything running in the notes origin
 * can read the sync keys and the decrypted notes, so the widget never runs there:
 * it lives on its own origin, inside a frame, and hands the app nothing but a
 * token. A configuration that would put it on the app's own origin is refused.
 */
export type TurnstileChallenge = { origin: string; sitekey: string; appOrigin: string };

export function turnstileChallenge(): TurnstileChallenge | null {
	const origin = publicEnv.PUBLIC_TURNSTILE_ORIGIN?.trim().replace(/\/$/, '');
	const sitekey = env.TURNSTILE_SITEKEY?.trim();
	const appOrigin = (env.SCRAPSCACHE_ORIGIN?.trim() || env.ORIGIN?.trim() || '').replace(/\/$/, '');
	if (!origin || !sitekey || !appOrigin) return null;
	if (!ORIGIN_RE.test(origin) || !ORIGIN_RE.test(appOrigin)) return null;
	if (origin.toLowerCase() === appOrigin.toLowerCase()) return null;
	return { origin, sitekey, appOrigin };
}

/**
 * Verify a Turnstile token for one action. Setting any Turnstile variable turns
 * verification on, and then all of them are required and must describe a
 * separate challenge origin: a partial or unsafe configuration fails closed
 * instead of silently accepting unverified requests.
 */
export async function verifyTurnstile(
	token: unknown,
	action: string,
	remoteIp: string
): Promise<TurnstileResult> {
	const secret = env.TURNSTILE_SECRET?.trim();
	const hostnames = new Set(
		(env.TURNSTILE_HOSTNAMES ?? '')
			.split(',')
			.map((hostname) => hostname.trim())
			.filter(Boolean)
	);
	const anySet =
		Boolean(publicEnv.PUBLIC_TURNSTILE_ORIGIN?.trim()) ||
		Boolean(env.TURNSTILE_SITEKEY?.trim()) ||
		Boolean(secret) ||
		hostnames.size > 0;
	if (!anySet) return 'disabled';
	if (!turnstileChallenge() || !secret || hostnames.size === 0) return 'misconfigured';
	if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH)
		return 'rejected';

	const body = new URLSearchParams({ secret, response: token });
	if (remoteIp !== 'unknown') body.set('remoteip', remoteIp);
	let result: { success?: unknown; action?: unknown; hostname?: unknown };
	try {
		const response = await fetch(SITEVERIFY_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			signal: AbortSignal.timeout(10_000),
			body
		});
		if (!response.ok) return 'rejected';
		result = (await response.json()) as typeof result;
	} catch {
		return 'rejected';
	}
	return result.success === true &&
		result.action === action &&
		typeof result.hostname === 'string' &&
		hostnames.has(result.hostname)
		? 'verified'
		: 'rejected';
}
