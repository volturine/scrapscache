import type { Handle } from '@sveltejs/kit';
import { recordHttpRequest } from '$lib/server/metrics';
import { turnstileChallenge } from '$lib/server/turnstile';

const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
	['referrer-policy', 'no-referrer'],
	['strict-transport-security', 'max-age=31536000; includeSubDomains'],
	['x-content-type-options', 'nosniff'],
	['permissions-policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()']
];

/** The frame-ancestors a response declares for itself, if any. */
function frameAncestors(policy: string | null): string | null {
	const directive = policy
		?.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith('frame-ancestors '));
	return directive ? directive.slice('frame-ancestors '.length).trim() : null;
}

/** Let the app frame the challenge origin, and nothing else it did not already allow. */
function allowChallengeFrame(policy: string, origin: string): string {
	return policy
		.split(';')
		.map((part) => {
			const directive = part.trim();
			return directive.startsWith('frame-src ') ? `${directive} ${origin}` : directive;
		})
		.join('; ');
}

export const handle: Handle = async ({ event, resolve }) => {
	const startedAt = performance.now();
	const suppliedRequestId = event.request.headers.get('x-request-id') ?? '';
	const requestId = /^[A-Za-z0-9._-]{1,128}$/.test(suppliedRequestId)
		? suppliedRequestId
		: crypto.randomUUID();

	const challenge = turnstileChallenge();
	const onChallengeOrigin =
		challenge !== null && event.url.origin.toLowerCase() === challenge.origin.toLowerCase();
	// The challenge origin exists to run one third-party page. Serving the app there
	// too would put a second copy of it, with its own storage, on a host that runs
	// code this repository does not control.
	const response =
		onChallengeOrigin && event.url.pathname !== '/turnstile'
			? new Response('Not found\n', { status: 404 })
			: await resolve(event, {
					transformPageChunk: ({ html }) => {
						const origin = event.url.origin;
						if (!origin) return html;
						const canonical = `${origin}${event.url.pathname}`;
						return html
							.replaceAll('https://scrapscache.com/og-preview.png', `${origin}/og-preview.png`)
							.replaceAll('https://scrapscache.com/', canonical)
							.replaceAll('https://scrapscache.com', origin);
					}
				});

	for (const [name, value] of SECURITY_HEADERS) response.headers.set(name, value);
	const policy = response.headers.get('content-security-policy');
	const ancestors = frameAncestors(policy);
	// A response that names who may frame it keeps that decision; everything else
	// refuses framing outright, for browsers that predate frame-ancestors too.
	if (!ancestors || ancestors === "'none'") response.headers.set('x-frame-options', 'DENY');
	if (challenge && !onChallengeOrigin && policy?.includes('frame-src ')) {
		response.headers.set('content-security-policy', allowChallengeFrame(policy, challenge.origin));
	}
	response.headers.set('x-request-id', requestId);

	const durationMs = performance.now() - startedAt;
	recordHttpRequest(event.url.pathname, response.status, durationMs);
	if (event.url.pathname.startsWith('/api/') && response.status >= 400) {
		console.info(
			JSON.stringify({
				level: 'info',
				event: 'http_request',
				requestId,
				path: event.url.pathname,
				status: response.status,
				durationMs: Math.round(durationMs)
			})
		);
	}
	return response;
};
