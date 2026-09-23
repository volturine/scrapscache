import { SyncClock, createEditContext } from '$lib/model';

const CLOCK_OFFSET_KEY = 'scrapscache-clock-offset';

/** The relay-corrected clock; its offset survives reloads so offline edits keep it. */
export const syncClock = new SyncClock();
if (typeof localStorage !== 'undefined') {
	syncClock.offset = Number(localStorage.getItem(CLOCK_OFFSET_KEY)) || 0;
}

export function observeRelayTime(serverTime: unknown, sentAt: number, receivedAt: number): void {
	if (!syncClock.observe(serverTime, sentAt, receivedAt)) return;
	try {
		localStorage.setItem(CLOCK_OFFSET_KEY, String(syncClock.offset));
	} catch {
		// Keep the in-memory offset; the next sync measures it again.
	}
}

/** Every note edit in this window is stamped with this clock and writer. */
export const editContext = createEditContext(() => syncClock.now());
