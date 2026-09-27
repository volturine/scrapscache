import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bindings = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('./env', () => ({ cloudflareBindings: () => bindings.value }));

import { SyncStore } from './syncStore';

/** Node's Response refuses status 101, which the Workers runtime allows for upgrades. */
class UpgradeResponse extends Response {
	private readonly upgrade?: number;
	readonly webSocket?: unknown;
	constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
		super(body, init?.status === 101 ? { ...init, status: 200 } : init);
		if (init?.status === 101) this.upgrade = 101;
		this.webSocket = init?.webSocket;
	}
	override get status() {
		return this.upgrade ?? super.status;
	}
}

describe('Workers live change sockets', () => {
	const socket = { kind: 'client end' };
	const coordinator = vi.fn(
		async (_url: string, _init?: RequestInit) =>
			new UpgradeResponse(null, { status: 101, webSocket: socket })
	);

	beforeEach(() => {
		vi.stubGlobal('Response', UpgradeResponse);
		coordinator.mockClear();
		bindings.value = {
			ACCOUNT_COORDINATOR: {
				idFromName: (name: string) => name,
				get: () => ({ fetch: coordinator })
			}
		};
	});
	afterEach(() => vi.unstubAllGlobals());

	it('hands the upgrade to the account coordinator and echoes only its own protocol', async () => {
		const response = (await new SyncStore().createEventSocket(
			'account-1',
			9_000,
			'window-1'
		)) as UpgradeResponse;
		expect(response.status).toBe(101);
		expect(response.webSocket).toBe(socket);
		expect(response.headers.get('sec-websocket-protocol')).toBe('scrapscache-sync');
		const [url, init] = coordinator.mock.calls[0];
		expect(new URL(url).pathname).toBe('/socket');
		expect(Object.fromEntries(new URL(url).searchParams)).toEqual({
			expiresAt: '9000',
			clientId: 'window-1'
		});
		expect(new Headers(init?.headers).get('upgrade')).toBe('websocket');
	});

	it('passes a refusal through, and serves no server-sent events', async () => {
		coordinator.mockResolvedValueOnce(
			new UpgradeResponse(JSON.stringify({ error: 'Too many open change streams' }), {
				status: 429
			})
		);
		expect((await new SyncStore().createEventSocket('account-1', 9_000)).status).toBe(429);
		expect((await new SyncStore().createEventStream('account-1')).status).toBe(426);
	});
});
