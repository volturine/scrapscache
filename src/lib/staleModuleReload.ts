export const STALE_MODULE_RELOAD_KEY = 'scrapscache-stale-module-reload';
export const STALE_MODULE_RELOAD_COOLDOWN_MS = 15_000;

/** What the person can do about a chunk the deployed app no longer serves. */
export const STALE_MODULE_MESSAGE =
	'Could not load that part of the app. Reload the page and try again.';

// Chrome, Firefox and Safari each word a failed dynamic import differently.
const MISSING_MODULE_MESSAGES = [
	'Failed to fetch dynamically imported module',
	'error loading dynamically imported module',
	'Importing a module script failed'
];

export function isMissingModuleError(cause: unknown): boolean {
	return (
		cause instanceof Error &&
		MISSING_MODULE_MESSAGES.some((message) => cause.message.includes(message))
	);
}

export function reloadOnceForMissingModule(
	cause: unknown,
	now = Date.now(),
	reload = () => location.reload()
): boolean {
	if (!isMissingModuleError(cause)) return false;
	try {
		const last = Number(sessionStorage.getItem(STALE_MODULE_RELOAD_KEY) ?? 0);
		if (last && now - last < STALE_MODULE_RELOAD_COOLDOWN_MS) return false;
		sessionStorage.setItem(STALE_MODULE_RELOAD_KEY, String(now));
	} catch {
		return false;
	}
	reload();
	return true;
}

/**
 * Load a lazily imported module. A chunk the server no longer has, because the
 * app was redeployed under this page, reloads the page once; failing that, the
 * error carries `STALE_MODULE_MESSAGE` instead of the browser's wording.
 */
export async function loadLazyModule<T>(
	load: () => Promise<T>,
	reload = () => location.reload()
): Promise<T> {
	try {
		return await load();
	} catch (cause) {
		if (!isMissingModuleError(cause)) throw cause;
		reloadOnceForMissingModule(cause, Date.now(), reload);
		throw new Error(STALE_MODULE_MESSAGE, { cause });
	}
}
