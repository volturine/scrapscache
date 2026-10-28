import type { SyncEventsConnection } from '#lib/syncEventsClient.js';
import { SYNC_EVENTS_PROTOCOL } from '#lib/syncEventsProtocol.js';

/** Keeps the socket open through proxies; the Worker runtime answers it without waking anything. */
export const SOCKET_PING_MS = 30_000;
/** The relay closes with this when the session expired; the token is then signed in again. */
const SESSION_EXPIRED = 4401;

/**
 * A WebSocket to the account's coordinator, which holds it with the Hibernation
 * API so an idle connection costs nothing. Browsers cannot set headers on a
 * WebSocket, so the access token travels as a subprotocol. Resolves when the
 * socket closes.
 */
export async function openSyncEvents(connection: SyncEventsConnection): Promise<void> {
	const { store, clientId, signal } = connection;
	if (!store.connectionToken) throw new Error('Live changes need a connection token');
	const session = await store.connectionToken();
	if (signal.aborted) return;
	const url = new URL('/api/sync/events', location.href);
	url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
	url.searchParams.set('clientId', clientId);
	const socket = new WebSocket(url, [SYNC_EVENTS_PROTOCOL, session.token]);
	await new Promise<void>((resolve) => {
		let opened = false;
		let ping: ReturnType<typeof setInterval> | undefined;
		const close = () => socket.close(1000);
		signal.addEventListener('abort', close, { once: true });
		socket.onopen = () => {
			opened = true;
			if (!connection.onOpen()) {
				close();
				return;
			}
			ping = setInterval(() => {
				if (socket.readyState === WebSocket.OPEN) socket.send('ping');
			}, SOCKET_PING_MS);
		};
		socket.onmessage = (event) => {
			if (typeof event.data !== 'string' || event.data === 'pong') return;
			try {
				connection.onSeq((JSON.parse(event.data) as { seq?: number }).seq);
			} catch {
				/* malformed message */
			}
		};
		socket.onclose = (event) => {
			// A refused handshake or an expired session: sign in afresh next time.
			if (!opened || event.code === SESSION_EXPIRED) session.refused();
			if (ping !== undefined) clearInterval(ping);
			signal.removeEventListener('abort', close);
			resolve();
		};
	});
}
