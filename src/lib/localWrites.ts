// What this window is still writing to a workspace's database. Stores that save in
// the background say here how to wait for what they have under way, so anything
// that needs the database to hold all of it, a sync or a rewrite, asks in one place.
import { waitForDeviceWrites } from '#lib/db/idb.js';

const drains = new Set<() => Promise<void>>();

/** A store with saves of its own under way says how to wait for them. */
export function trackLocalWrites(drain: () => Promise<void>): void {
	drains.add(drain);
}

/** Everything this window was writing for a workspace has reached its database. */
export async function localWritesLanded(pid: string): Promise<void> {
	await Promise.all([...drains].map((drain) => drain()));
	await waitForDeviceWrites(pid);
}
