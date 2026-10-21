import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { SCRAPSCACHE_ACCESS_AUD, SCRAPSCACHE_ACCESS_TEAM_DOMAIN } from '$app/env/private';

const TEAM_DOMAIN_RE = /^[a-z0-9-]+\.cloudflareaccess\.com$/;

/** Failures that say the token is bad, not that its keys could not be read. */
const REFUSALS = [
	errors.JWTExpired,
	errors.JWTClaimValidationFailed,
	errors.JWTInvalid,
	errors.JWSInvalid,
	errors.JWSSignatureVerificationFailed,
	errors.JWKSNoMatchingKey,
	errors.JWKSMultipleMatchingKeys,
	errors.JOSEAlgNotAllowed,
	errors.JOSENotSupported
];

type AccessApp = { issuer: string; audience: string };

let reportedInvalid = false;

function logAccess(event: string, message: string): void {
	console.error(JSON.stringify({ level: 'error', event, message }));
}

/** The Access application in front of the admin routes, when both halves are set. */
function accessApp(): AccessApp | null {
	const team = SCRAPSCACHE_ACCESS_TEAM_DOMAIN?.trim().toLowerCase();
	const audience = SCRAPSCACHE_ACCESS_AUD?.trim();
	if (!team && !audience) return null;
	if (!team || !audience || !TEAM_DOMAIN_RE.test(team)) {
		if (!reportedInvalid) {
			reportedInvalid = true;
			logAccess(
				'access_config_invalid',
				'Cloudflare Access needs both a <team>.cloudflareaccess.com domain and an audience tag; it is off'
			);
		}
		return null;
	}
	return { issuer: `https://${team}`, audience };
}

/** One key set per team, so its keys are fetched once per isolate and refetched on rotation. */
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keysFor(issuer: string): ReturnType<typeof createRemoteJWKSet> {
	let keys = keySets.get(issuer);
	if (!keys) {
		keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
		keySets.set(issuer, keys);
	}
	return keys;
}

/**
 * Whether Cloudflare Access let this request through. Access signs every request
 * it admits with a JWT for its application; the header alone proves nothing, since
 * anything that reaches the Worker another way can set it, so the signature,
 * issuer and audience are all checked against the team's published keys.
 */
export async function passedCloudflareAccess(request: Request): Promise<boolean> {
	const app = accessApp();
	if (!app) return false;
	const assertion = request.headers.get('cf-access-jwt-assertion');
	if (!assertion) return false;
	try {
		await jwtVerify(assertion, keysFor(app.issuer), {
			issuer: app.issuer,
			audience: app.audience,
			algorithms: ['RS256']
		});
		return true;
	} catch (error) {
		// A forged, expired or foreign token is a refusal like a wrong admin token.
		// Anything else, such as the team's keys failing to load, is an outage, and
		// the operator should hear of it rather than see only a 404.
		if (!REFUSALS.some((refusal) => error instanceof refusal)) {
			logAccess(
				'access_keys_unavailable',
				error instanceof Error ? error.message : 'Could not verify Cloudflare Access'
			);
		}
		return false;
	}
}
