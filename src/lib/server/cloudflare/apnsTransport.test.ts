import { afterEach, describe, expect, it, vi } from 'vitest';
import { postToApple } from './apnsTransport';

afterEach(() => vi.unstubAllGlobals());

describe("a Worker's request to Apple's push service", () => {
	it('posts to the host and path it is given, and hands back the status and the reply', async () => {
		const fetchMock = vi.fn(
			async (_url: string, _init: RequestInit) =>
				new Response('{"reason":"BadDeviceToken"}', { status: 400 })
		);
		vi.stubGlobal('fetch', fetchMock);
		const answer = await postToApple(
			'api.push.apple.com',
			'/3/device/abcd',
			{ 'apns-topic': 'com.scrapscache.app' },
			'{"aps":{}}',
			10_000
		);
		expect(answer).toEqual({ status: 400, body: '{"reason":"BadDeviceToken"}' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.push.apple.com/3/device/abcd');
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({ 'apns-topic': 'com.scrapscache.app' });
		expect(init.body).toBe('{"aps":{}}');
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it('never follows a redirect, which would carry the push to another host', async () => {
		const fetchMock = vi.fn(
			async (_url: string, _init: RequestInit) => new Response(null, { status: 200 })
		);
		vi.stubGlobal('fetch', fetchMock);
		await postToApple('api.push.apple.com', '/3/device/abcd', {}, '{}', 10_000);
		expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
	});
});
