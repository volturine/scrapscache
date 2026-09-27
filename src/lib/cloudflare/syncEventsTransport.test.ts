import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSyncEvents, SOCKET_PING_MS } from './syncEventsTransport';

class FakeSocket {
	static OPEN = 1;
	static last: FakeSocket;
	readyState = 0;
	sent: string[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: ((event: { code: number }) => void) | null = null;
	constructor(
		readonly url: URL,
		readonly protocols: string[]
	) {
		FakeSocket.last = this;
	}
	send(message: string) {
		this.sent.push(message);
	}
	open() {
		this.readyState = FakeSocket.OPEN;
		this.onopen?.();
	}
	close(code = 1000) {
		this.readyState = 3;
		this.onclose?.({ code });
	}
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function connection() {
	const refused = vi.fn();
	const controller = new AbortController();
	const onSeq = vi.fn();
	const onOpen = vi.fn(() => true);
	const store = {
		isLoggedIn: true,
		authorizedFetch: vi.fn(),
		connectionToken: vi.fn(async () => ({ token: 't'.repeat(43), refused }))
	};
	return { store, refused, controller, onSeq, onOpen };
}

async function open(parts: ReturnType<typeof connection>) {
	const done = openSyncEvents({
		store: parts.store,
		clientId: 'window-1',
		signal: parts.controller.signal,
		onOpen: parts.onOpen,
		onSeq: parts.onSeq
	});
	await vi.waitFor(() => expect(parts.store.connectionToken).toHaveBeenCalled());
	await Promise.resolve();
	return { done, socket: FakeSocket.last };
}

describe('the Workers live change socket', () => {
	it('sends the token as a subprotocol, never in the address', async () => {
		const parts = connection();
		const { socket } = await open(parts);
		expect(socket.protocols).toEqual(['scrapscache-sync', 't'.repeat(43)]);
		expect(socket.url.protocol).toBe('ws:');
		expect(socket.url.pathname).toBe('/api/sync/events');
		expect(Object.fromEntries(socket.url.searchParams)).toEqual({ clientId: 'window-1' });
		expect(socket.url.href).not.toContain('t'.repeat(43));
		socket.close();
	});

	it('passes change signals on, keeps the socket alive, and ignores heartbeat replies', async () => {
		const parts = connection();
		const { socket, done } = await open(parts);
		socket.open();
		expect(parts.onOpen).toHaveBeenCalled();
		socket.onmessage?.({ data: 'pong' });
		socket.onmessage?.({ data: JSON.stringify({ seq: 7 }) });
		expect(parts.onSeq).toHaveBeenCalledTimes(1);
		expect(parts.onSeq).toHaveBeenCalledWith(7);
		await vi.advanceTimersByTimeAsync(SOCKET_PING_MS);
		expect(socket.sent).toEqual(['ping']);
		parts.controller.abort();
		await done;
		expect(parts.refused).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(SOCKET_PING_MS * 3);
		expect(socket.sent).toEqual(['ping']);
	});

	it('signs in afresh after a refused handshake or an expired session', async () => {
		const refusedHandshake = connection();
		const first = await open(refusedHandshake);
		first.socket.close(1006);
		await first.done;
		expect(refusedHandshake.refused).toHaveBeenCalledOnce();

		const expired = connection();
		const second = await open(expired);
		second.socket.open();
		second.socket.close(4401);
		await second.done;
		expect(expired.refused).toHaveBeenCalledOnce();
	});

	it('closes at once when the connection is no longer wanted', async () => {
		const parts = connection();
		parts.onOpen.mockReturnValue(false);
		const { socket, done } = await open(parts);
		socket.open();
		await done;
		expect(socket.readyState).toBe(3);
	});
});
