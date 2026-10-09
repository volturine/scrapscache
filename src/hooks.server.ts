import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { recordHttpRequest } from '#lib/server/metrics.js';
import { startWakeTimer } from '#lib/server/wakeTimer.js';
import { configuredOrigin } from '#lib/server/publicOrigin.js';
import { turnstileChallenge } from '#lib/server/turnstile.js';

const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
	['referrer-policy', 'no-referrer'],
	// No includeSubDomains: HSTS cannot name hosts, and every host this Worker
	// serves (app, dev, challenge) sends this header for itself. Covering the
	// whole zone would also bind subdomains this app does not run.
	['strict-transport-security', 'max-age=31536000'],
	['x-content-type-options', 'nosniff'],
	// The pairing scanner reads a QR code with this origin's camera; frames get none.
	['permissions-policy', 'camera=(self), geolocation=(), microphone=(), payment=(), usb=()']
];

/** The frame-ancestors a response declares for itself, if any. */
function frameAncestors(policy: string | null): string | null {
	const directive = policy
		?.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith('frame-ancestors '));

	return directive ? directive.slice('frame-ancestors '.length).trim() : null;
}

const DEFAULT_PAGE_META = /[ \t]*<!-- page-meta:[\s\S]*?<!-- \/page-meta -->\n?/;

/**
 * src/app.html carries the client-only app's title and description. A server-rendered
 * page (privacy, terms) renders its own through PageMeta.svelte; keep only that copy,
 * so crawlers and link previews never see two titles or descriptions.
 */
function withOnePageMeta(html: string): string {
	const defaults = DEFAULT_PAGE_META.exec(html);
	if (!defaults) return html;
	const page = html.replace(defaults[0], '');
	return page.includes('<meta name="description"') ? page : html;
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

/** Reminder wakes stored before this server started are delivered from here on. */
export const init: ServerInit = async () => {
	await startWakeTimer();
};

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
						const origin = configuredOrigin() ?? event.url.origin;
						const canonical = `${origin}${event.url.pathname}`;
						return withOnePageMeta(html)
							.replaceAll('https://scrapscache.com/og-preview.png', `${origin}/og-preview.png`)
							.replaceAll('https://scrapscache.com/', canonical)
							.replaceAll('https://scrapscache.com', origin);
					}
				});

	for (const [name, value] of SECURITY_HEADERS) response.headers.set(name, value);
	if (response.headers.get('content-type')?.toLowerCase().startsWith('text/html')) {
		const cacheControl = response.headers.get('cache-control');
		const directives =
			cacheControl?.split(',').map((directive) => directive.trim().toLowerCase()) ?? [];
		const preventsSharedCaching = directives.some((directive) =>
			/^(?:private|no-cache|no-store)(?:[= ]|$)/.test(directive)
		);

		if (!preventsSharedCaching) {
			// The HTML shell contains build-specific asset URLs. Keep it out of
			// shared caches so a deploy cannot leave clients on a stale shell.
			response.headers.set('cache-control', 'private, no-transform');
		} else if (!directives.includes('no-transform')) {
			response.headers.set('cache-control', `${cacheControl}, no-transform`);
		}
	}
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
