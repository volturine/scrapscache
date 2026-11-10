import { openSyncEvents as openSocket } from '#lib/cloudflare/syncEventsTransport.js';
import { serverSetting } from '#lib/serverOrigin.svelte.js';
import type { SyncEventsConnection } from '#lib/syncEventsClient.js';
import { openSyncEvents as openStream, SyncEventsUpgradeRequired } from '../syncEventsTransport.js';

/** The server last found to want a WebSocket, so reconnecting need not ask again. */
let socketServer: string | null = null;

/**
 * Live changes from a server this build knows nothing about. A web build is
 * served by its relay and is built for it; the app asks. It opens the stream a
 * Node relay serves, and a Workers relay answers that with 426.
 */
export async function openSyncEvents(connection: SyncEventsConnection): Promise<void> {
	const server = serverSetting.origin;
	if (socketServer === server) {
		let opened = false;
		await openSocket({
			...connection,
			onOpen: () => (opened = connection.onOpen())
		});
		// The server may have moved to another platform: ask again next time.
		if (!opened) socketServer = null;
		return;
	}
	try {
		await openStream(connection);
	} catch (error) {
		if (!(error instanceof SyncEventsUpgradeRequired)) throw error;
		socketServer = server;
		await openSyncEvents(connection);
	}
}
