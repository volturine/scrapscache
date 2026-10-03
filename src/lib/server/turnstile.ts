import { TURNSTILE_SITEKEY, TURNSTILE_SECRET, TURNSTILE_HOSTNAMES } from '$app/env/private';
import { PUBLIC_TURNSTILE_ORIGIN } from '$app/env/public';
import { Effect, Schema } from 'effect';
import { configuredOrigin } from '#lib/server/publicOrigin.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;
const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

export type TurnstileResult = 'disabled' | 'verified' | 'rejected' | 'misconfigured';

const SiteVerifyResponse = Schema.Struct({
	success: Schema.Boolean,
	action: Schema.optional(Schema.String),
	hostname: Schema.optional(Schema.String)
});

/** Cloudflare's verdict on one token; any failure to get or read it is a failure. */
const siteverify = (body: URLSearchParams) =>
	Effect.tryPromise(async (signal) => {
		const response = await fetch(SITEVERIFY_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
			signal
		});
		if (!response.ok) throw new Error(`Turnstile siteverify returned ${response.status}`);
		return (await response.json()) as unknown;
	}).pipe(
		Effect.timeout('10 seconds'),
		Effect.flatMap(Schema.decodeUnknownEffect(SiteVerifyResponse))
	);

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
	const origin = PUBLIC_TURNSTILE_ORIGIN?.trim().replace(/\/$/, '');
	const sitekey = TURNSTILE_SITEKEY?.trim();
	const appOrigin = configuredOrigin() ?? '';
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
	const secret = TURNSTILE_SECRET?.trim();
	const hostnames = new Set(
		(TURNSTILE_HOSTNAMES ?? '')
			.split(',')
			.map((hostname) => hostname.trim())
			.filter(Boolean)
	);
	const anySet =
		Boolean(PUBLIC_TURNSTILE_ORIGIN?.trim()) ||
		Boolean(TURNSTILE_SITEKEY?.trim()) ||
		Boolean(secret) ||
		hostnames.size > 0;
	if (!anySet) return 'disabled';
	if (!turnstileChallenge() || !secret || hostnames.size === 0) return 'misconfigured';
	if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH)
		return 'rejected';

	const body = new URLSearchParams({ secret, response: token });
	if (remoteIp !== 'unknown') body.set('remoteip', remoteIp);
	return Effect.runPromise(
		siteverify(body).pipe(
			Effect.map((result): TurnstileResult =>
				result.success &&
				result.action === action &&
				result.hostname !== undefined &&
				hostnames.has(result.hostname)
					? 'verified'
					: 'rejected'
			),
			Effect.orElseSucceed((): TurnstileResult => 'rejected')
		)
	);
}
