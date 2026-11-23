// Copies kept in `localStorage` for a quicker start. IndexedDB holds the durable
// copy, so one that does not fit is only skipped.

/** A per-workspace localStorage key. */
export function workspaceKey(base: string, pid: string): string {
	return `${base}:${pid}`;
}

function isQuotaExceeded(error: unknown): boolean {
	return (
		error instanceof DOMException &&
		(error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
	);
}

/**
 * Write a fast-boot mirror to localStorage. A full localStorage is not the
 * caller's failure: the mirror only speeds the next boot, and the sync or
 * import that wrote it has its durable copy elsewhere. Returns whether the
 * write landed; any other error is the caller's to see.
 */
export function writeMirror(key: string, value: string): boolean {
	try {
		localStorage.setItem(key, value);
		return true;
	} catch (error) {
		if (!isQuotaExceeded(error)) throw error;
		console.warn('[storage] localStorage is full; mirror not updated:', key);
		return false;
	}
}
