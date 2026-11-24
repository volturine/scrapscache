const queues = new Map<string, Promise<unknown>>();

/**
 * Run under a lock that every window of this origin shares, in the order asked.
 * An origin that is not secure has no Web Locks; the order then still holds
 * inside this window.
 */
export function withLock<T>(name: string, run: () => Promise<T>): Promise<T> {
	const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
	if (locks?.request) return locks.request(name, run);
	const held = (queues.get(name) ?? Promise.resolve()).then(run);
	queues.set(
		name,
		held.catch(() => undefined)
	);
	return held;
}

/**
 * Serializes what changes the workspaces on this device or the one a window shows:
 * switching, creating, unlinking, deleting, an import landing. Held only for work
 * on this device, never while the relay is waited for, and never by a sync.
 */
export const WORKSPACE_LOCK = 'scrapscache-workspaces';

export function withWorkspaceLock<T>(run: () => Promise<T>): Promise<T> {
	return withLock(WORKSPACE_LOCK, run);
}
