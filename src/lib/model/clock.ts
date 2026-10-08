/** A round trip longer than this says too little about when the relay read its clock. */
const MAX_ROUND_TRIP_MS = 5_000;
/**
 * The relay's word on the time moves the clock at most this far. Edit times
 * decide per-field merges, so a relay (or anything answering for it) must not
 * be able to date this device's edits years ahead of every other writer.
 */
export const MAX_CLOCK_OFFSET_MS = 24 * 60 * 60_000;

/**
 * Edit times on the relay's clock. A device clock can be minutes off, and the
 * faster device would win every conflicting edit. The relay reports its time on
 * each sync, so every writer stamps edits on the same timeline.
 */
export class SyncClock {
	offset = 0;

	now(): number {
		return Date.now() + this.offset;
	}

	/** Adopt the relay time as of halfway through the round trip that returned it, within a day. */
	observe(serverTime: unknown, sentAt: number, receivedAt: number): boolean {
		const roundTrip = receivedAt - sentAt;
		if (typeof serverTime !== 'number' || !Number.isFinite(serverTime)) return false;
		if (roundTrip < 0 || roundTrip > MAX_ROUND_TRIP_MS) return false;
		const offset = Math.round(serverTime - (sentAt + receivedAt) / 2);
		this.offset = Math.max(-MAX_CLOCK_OFFSET_MS, Math.min(MAX_CLOCK_OFFSET_MS, offset));
		return true;
	}
}
