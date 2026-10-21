import { SCRAPSCACHE_ADMIN_ORIGIN } from '$app/env/private';

/**
 * The operator dashboard, its API, and the Prometheus scrape. Matched on the path
 * as SvelteKit's router decodes it, so `/api/%61dmin` is the admin API here too; a
 * path that does not decode is treated as admin, which only ever hides it.
 */
export function isAdminRoute(rawPathname: string): boolean {
	let pathname: string;
	try {
		pathname = rawPathname.split('%25').map(decodeURI).join('%25');
	} catch {
		return true;
	}
	return (
		pathname === '/admin' ||
		pathname.startsWith('/admin/') ||
		pathname.startsWith('/api/admin/') ||
		pathname === '/metrics'
	);
}

/** The value as an origin, or null when it is anything more or less than one. */
function asOrigin(value: string): string | null {
	if (!URL.canParse(value)) return null;
	const url = new URL(value);
	const bare = url.origin.toLowerCase() === value.toLowerCase();
	return bare && (url.protocol === 'https:' || url.protocol === 'http:') ? url.origin : null;
}

let reportedInvalid = false;

/**
 * Where a request belongs when the dashboard has an origin of its own. That
 * origin serves the admin routes and nothing else, so no copy of the notes app,
 * with its storage and sync keys, runs beside the dashboard; the app's origin
 * stops answering them, so the dashboard has one address an Access policy can
 * cover whole. Unset keeps both on the app's origin.
 *
 * A value that is not a bare origin is a mistake, and fails closed: the admin
 * routes then answer nowhere rather than on the app's origin.
 */
export function adminRouting(url: URL): 'serve' | 'not-found' | 'dashboard' {
	const configured = SCRAPSCACHE_ADMIN_ORIGIN?.trim().replace(/\/$/, '');
	if (!configured) return 'serve';
	const admin = isAdminRoute(url.pathname);
	const adminOrigin = asOrigin(configured);
	if (!adminOrigin) {
		if (admin && !reportedInvalid) {
			reportedInvalid = true;
			console.error(
				JSON.stringify({
					level: 'error',
					event: 'admin_origin_invalid',
					message: 'SCRAPSCACHE_ADMIN_ORIGIN is not an origin; the admin routes are off'
				})
			);
		}
		return admin ? 'not-found' : 'serve';
	}
	const onAdminOrigin = url.origin === adminOrigin;
	if (admin === onAdminOrigin) return 'serve';
	return onAdminOrigin && url.pathname === '/' ? 'dashboard' : 'not-found';
}
