import { beforeEach, describe, expect, it, vi } from 'vitest';

const transports = vi.hoisted(() => ({
	socket: vi.fn(),
	native: { on: true }
}));
vi.mock('#lib/native.js', () => ({ isNativeApp: () => transports.native.on }));
vi.mock('#lib/cloudflare/syncEventsTransport.js', () => ({ openSyncEvents: transports.socket }));

import { serverSetting } from '#lib/serverOrigin.svelte.js';
import type { SyncEventsConnection } from '#lib/syncEventsClient.js';
import { openSyncEvents } from './syncEventsTransport';

function streamResponse(): Response {
	return new Response('data: {"seq":7}\n\n', { headers: { 'content-type': 'text/event-stream' } });
}

function connection(reply: () => Response) {
	const authorizedFetch = vi.fn(async () => reply());
	const onOpen = vi.fn(() => true);
	const onSeq = vi.fn();
	const value: SyncEventsConnection = {
		store: { isLoggedIn: true, authorizedFetch },
		clientId: 'window-1',
		signal: new AbortController().signal,
		onOpen,
		onSeq
	};
	return { value, authorizedFetch, onOpen, onSeq };
}

const workers = () => new Response('{}', { status: 426 });
let servers = 0;

beforeEach(() => {
	transports.socket.mockReset();
	// A server of its own per test: the transport remembers what each one wanted.
	serverSetting.set(`https://relay-${(servers += 1)}.example`);
});

describe('the app reaching a server it knows nothing about', () => {
	it('reads the stream from a Node relay and opens no socket', async () => {
		const parts = connection(streamResponse);
		await openSyncEvents(parts.value);
		expect(parts.onSeq).toHaveBeenCalledWith(7);
		expect(transports.socket).not.toHaveBeenCalled();
	});

	it('asks with a path, which authorizedFetch resolves against the server once', async () => {
		const parts = connection(streamResponse);
		await openSyncEvents(parts.value);
		expect(parts.authorizedFetch).toHaveBeenCalledWith(
			'/api/sync/events?clientId=window-1',
			expect.objectContaining({ signal: parts.value.signal })
		);
	});

	it('opens the socket when a Workers relay answers 426, on the same attempt', async () => {
		const parts = connection(workers);
		await openSyncEvents(parts.value);
		expect(transports.socket).toHaveBeenCalledTimes(1);
	});

	it('goes straight to the socket on the next connection', async () => {
		transports.socket.mockImplementation(async (open: SyncEventsConnection) => {
			open.onOpen();
		});
		const parts = connection(workers);
		await openSyncEvents(parts.value);
		await openSyncEvents(parts.value);
		expect(parts.authorizedFetch).toHaveBeenCalledTimes(1);
		expect(transports.socket).toHaveBeenCalledTimes(2);
		expect(parts.onOpen).toHaveBeenCalledTimes(2);
	});

	it('asks again after a socket that never opened', async () => {
		transports.socket.mockImplementationOnce(async () => undefined);
		const parts = connection(workers);
		await openSyncEvents(parts.value);
		expect(parts.authorizedFetch).toHaveBeenCalledTimes(1);
		await openSyncEvents(parts.value);
		expect(parts.authorizedFetch).toHaveBeenCalledTimes(2);
	});

	it('asks a newly named server, whatever the last one wanted', async () => {
		const parts = connection(workers);
		await openSyncEvents(parts.value);
		serverSetting.set('https://another-relay.example');
		await openSyncEvents(parts.value);
		expect(parts.authorizedFetch).toHaveBeenCalledTimes(2);
	});

	it('leaves any other failure to the client, which backs off', async () => {
		const parts = connection(() => new Response('{}', { status: 503 }));
		await expect(openSyncEvents(parts.value)).rejects.toThrow('SSE error: 503');
		expect(transports.socket).not.toHaveBeenCalled();
	});
});
