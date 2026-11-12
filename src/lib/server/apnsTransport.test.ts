// @vitest-environment node
import {
	createServer,
	type Http2Server,
	type ServerHttp2Session,
	type ServerHttp2Stream
} from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { http2Poster } from './apnsTransport';

/** Where this machine reaches its own listeners: the override the browser tests take. */
const HOST = process.env.PLAYWRIGHT_HOST || '127.0.0.1';

type Asked = { path: string; topic: string; body: string };

let server: Http2Server | null = null;

/** A stand-in for Apple: counts its connections and answers each request as `answer` says. */
async function apple(answer: (stream: ServerHttp2Stream, asked: Asked) => void = accept) {
	const connections: ServerHttp2Session[] = [];
	const requests: Asked[] = [];
	const listening = createServer();
	server = listening;
	listening.on('session', (session) => connections.push(session));
	listening.on('stream', (stream: ServerHttp2Stream, headers) => {
		let body = '';
		stream.setEncoding('utf8');
		stream.on('data', (chunk: string) => {
			body += chunk;
		});
		stream.on('end', () => {
			const asked = {
				path: String(headers[':path']),
				topic: String(headers['apns-topic']),
				body
			};
			requests.push(asked);
			answer(stream, asked);
		});
		stream.on('error', () => undefined);
	});
	await new Promise<void>((resolve) => listening.listen(0, resolve));
	const { port } = listening.address() as AddressInfo;
	const post = http2Poster(() => `http://${HOST}:${port}`);
	const send = (path = '/3/device/abcd', timeoutMs = 5_000) =>
		post(
			'api.push.apple.com',
			path,
			{ 'apns-topic': 'com.scrapscache.app' },
			'{"aps":{}}',
			timeoutMs
		);
	return { connections, requests, send, port };
}

function accept(stream: ServerHttp2Stream) {
	stream.respond({ ':status': 200 });
	stream.end();
}

afterEach(async () => {
	const listening = server;
	server = null;
	if (!listening) return;
	await new Promise<void>((resolve) => {
		listening.close(() => resolve());
		// Connections the client still holds open would keep the server from closing.
		listening.emit('test-stop');
	});
});

/** Close the server's side of every connection, as a server shutting its sessions does. */
function stopOnTeardown(connections: ServerHttp2Session[]) {
	server?.once('test-stop', () => {
		for (const connection of connections) connection.destroy();
	});
}

describe("the relay's requests to Apple's push service", () => {
	it('posts the path, headers and body, and hands back the status and the reply', async () => {
		const { connections, requests, send } = await apple((stream) => {
			stream.respond({ ':status': 400 });
			stream.end('{"reason":"BadDeviceToken"}');
		});
		stopOnTeardown(connections);
		await expect(send('/3/device/abcd')).resolves.toEqual({
			status: 400,
			body: '{"reason":"BadDeviceToken"}'
		});
		expect(requests).toEqual([
			{ path: '/3/device/abcd', topic: 'com.scrapscache.app', body: '{"aps":{}}' }
		]);
	});

	it('sends every push over the one connection it keeps open', async () => {
		const { connections, requests, send } = await apple();
		stopOnTeardown(connections);
		await send('/3/device/1');
		await Promise.all([send('/3/device/2'), send('/3/device/3'), send('/3/device/4')]);
		expect(requests).toHaveLength(4);
		expect(connections).toHaveLength(1);
	});

	it('opens another connection once Apple tells it to go away', async () => {
		const { connections, send } = await apple();
		stopOnTeardown(connections);
		await send();
		const left = new Promise<void>((resolve) => connections[0].once('close', () => resolve()));
		connections[0].close();
		await left;
		await expect(send()).resolves.toMatchObject({ status: 200 });
		expect(connections).toHaveLength(2);
	});

	it('opens another connection after the one it had was cut', async () => {
		const { connections, send } = await apple();
		stopOnTeardown(connections);
		await send();
		const cut = new Promise<void>((resolve) => connections[0].once('close', () => resolve()));
		connections[0].destroy();
		await cut;
		await expect
			.poll(() =>
				send().then(
					(answer) => answer.status,
					() => 0
				)
			)
			.toBe(200);
		expect(connections.length).toBeGreaterThanOrEqual(2);
	});

	it('gives up on a push Apple does not answer, and leaves that connection behind', async () => {
		let silent = true;
		const { connections, send } = await apple((stream) => {
			if (!silent) accept(stream);
		});
		stopOnTeardown(connections);
		await expect(send('/3/device/abcd', 100)).rejects.toThrow('Apple did not answer in time');
		silent = false;
		await expect(send()).resolves.toMatchObject({ status: 200 });
		expect(connections).toHaveLength(2);
	});

	it('leaves the other pushes on a connection alone when one of them gets no answer in time', async () => {
		const { connections, send } = await apple((stream, asked) => {
			if (asked.path !== '/3/device/silent') accept(stream);
		});
		stopOnTeardown(connections);
		const [silent, answered] = await Promise.allSettled([
			send('/3/device/silent', 200),
			send('/3/device/abcd')
		]);
		expect(silent.status).toBe('rejected');
		expect(answered).toMatchObject({ status: 'fulfilled', value: { status: 200 } });
		await expect(send()).resolves.toMatchObject({ status: 200 });
		expect(connections).toHaveLength(2);
	});

	it('fails a push when Apple cannot be reached, and reaches it again the next time', async () => {
		const { connections, port } = await apple();
		stopOnTeardown(connections);
		let reachable = false;
		const post = http2Poster(() => `http://${HOST}:${reachable ? port : 1}`);
		const send = () => post('api.push.apple.com', '/3/device/abcd', {}, '{}', 5_000);
		await expect(send()).rejects.toThrow();
		reachable = true;
		await expect(send()).resolves.toMatchObject({ status: 200 });
	});
});
