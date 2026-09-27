/**
 * Browsers cannot set headers on a WebSocket, so the live note-sync socket sends
 * its access token as a second subprotocol after this one. The server answers
 * with this one only, so the token is never echoed back.
 */
export const SYNC_EVENTS_PROTOCOL = 'scrapscache-sync';

/** The access token a WebSocket upgrade offers, or null when it is not ours. */
export function syncEventsToken(offered: string | null): string | null {
	const protocols = (offered ?? '').split(',').map((value) => value.trim());
	return protocols.length === 2 && protocols[0] === SYNC_EVENTS_PROTOCOL && protocols[1]
		? protocols[1]
		: null;
}

/** A window's id, echoed by the relay only to keep its own uploads from signalling it. */
export function validSyncClientId(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value);
}
