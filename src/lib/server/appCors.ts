/**
 * The iPhone app's page runs at its own origin and reaches the sync API across
 * it, so the API answers that origin's preflights and names it in each reply.
 * Nothing else is opened up: no credentials, only the sync routes, only the
 * origins the apps are built with.
 */
export const APP_ORIGINS: ReadonlySet<string> = new Set(['capacitor://localhost']);

const CORS_PATH_PREFIX = '/api/sync/';
const ALLOWED_METHODS = 'GET, POST, PUT, DELETE';
const ALLOWED_HEADERS = 'authorization, content-type, x-sync-client-id, x-scrapscache-sync-version';
const EXPOSED_HEADERS = 'x-request-id';

/** The app origin a request comes from, when it is one the API answers. */
export function appOrigin(request: Request, pathname: string): string | null {
	if (!pathname.startsWith(CORS_PATH_PREFIX)) return null;
	const origin = request.headers.get('origin');
	return origin && APP_ORIGINS.has(origin) ? origin : null;
}

/** The reply to a preflight from an app origin; null when the request is not one. */
export function preflightResponse(request: Request, pathname: string): Response | null {
	if (request.method !== 'OPTIONS') return null;
	const origin = appOrigin(request, pathname);
	if (!origin || !request.headers.has('access-control-request-method')) return null;
	const headers = new Headers();
	allowAppOrigin(headers, origin);
	headers.set('access-control-allow-methods', ALLOWED_METHODS);
	headers.set('access-control-allow-headers', ALLOWED_HEADERS);
	headers.set('access-control-max-age', '86400');
	return new Response(null, { status: 204, headers });
}

/** Name the app origin on a reply, so its page may read it. */
export function allowAppOrigin(headers: Headers, origin: string): void {
	headers.set('access-control-allow-origin', origin);
	headers.set('access-control-expose-headers', EXPOSED_HEADERS);
	headers.append('vary', 'Origin');
}
