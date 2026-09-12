import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;

export type TurnstileResult = 'disabled' | 'verified' | 'rejected' | 'misconfigured';

/**
 * Verify a Turnstile token for one action. Setting any of the sitekey, secret, or
 * hostnames turns verification on, and then all three are required: a partial
 * configuration fails closed instead of silently accepting unverified requests.
 */
export async function verifyTurnstile(
	token: unknown,
	action: string,
	remoteIp: string
): Promise<TurnstileResult> {
	const sitekey = publicEnv.PUBLIC_TURNSTILE_SITEKEY?.trim();
	const secret = env.TURNSTILE_SECRET?.trim();
	const hostnames = new Set(
		(env.TURNSTILE_HOSTNAMES ?? '')
			.split(',')
			.map((hostname) => hostname.trim())
			.filter(Boolean)
	);
	if (!sitekey && !secret && hostnames.size === 0) return 'disabled';
	if (!sitekey || !secret || hostnames.size === 0) return 'misconfigured';
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
