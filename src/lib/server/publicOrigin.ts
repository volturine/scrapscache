import { SCRAPSCACHE_ORIGIN } from '$app/env/private';

/**
 * The deployment's configured public origin, without a trailing slash. A request's
 * own URL is built from proxy headers, so links meant to be canonical use this.
 */
export function configuredOrigin(): string | null {
	return SCRAPSCACHE_ORIGIN?.trim().replace(/\/$/, '') || null;
}
