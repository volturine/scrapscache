import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	SYNC_DELTA_PATH,
	SYNC_PROTOCOL_HEADER,
	SYNC_PROTOCOL_VERSION
} from '#lib/model/protocol.js';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { SyncStore } from './sync.svelte';

type Reply =
	| { network: true }
	| { status: number; body?: Record<string, unknown>; headers?: Record<string, string> };

let replies: Reply[] = [];
let sends = 0;
let sentHeaders: Record<string, string>[] = [];

/** Answers each send with the next scripted reply, the way the browser reports it. */
class FakeXhr {
	status = 0;
	responseText = '';
	timeout = 0;
	upload = { onprogress: null };
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	ontimeout: (() => void) | null = null;
	onabort: (() => void) | null = null;
	onprogress: (() => void) | null = null;
	private headers: Record<string, string> = {};
	open(): void {}
	setRequestHeader(name: string, value: string): void {
		this.headers[name.toLowerCase()] = value;
	}
	getResponseHeader(name: string): string | null {
		return this.headers[name.toLowerCase()] ?? null;
	}
	send(): void {
		sends += 1;
		sentHeaders.push({ ...this.headers });
		const reply = replies.shift() ?? { status: 200, body: {} };
		queueMicrotask(() => {
			if ('network' in reply) return this.onerror?.();
			this.status = reply.status;
			this.responseText = JSON.stringify(reply.body ?? {});
			this.headers = reply.headers ?? {};
			this.onload?.();
		});
	}
}

type Transport = {
	sendSyncRequest(
		path: string,
		payload: string,
		uploadBytes: number,
		indicate: boolean
	): Promise<{ success: boolean; status?: number; error?: string; retryAfterSeconds?: number }>;
	accessToken(): Promise<string>;
};

function transport(store: SyncStore): Transport {
	const internals = store as unknown as Transport;
	vi.spyOn(internals, 'accessToken').mockResolvedValue('token');
	return internals;
}

async function send(store: SyncStore) {
	const pending = transport(store).sendSyncRequest(SYNC_DELTA_PATH, '{}', 2, false);
	await vi.runAllTimersAsync();
	return pending;
}

describe('sync transport', () => {
	let store: SyncStore;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('XMLHttpRequest', FakeXhr);
		replies = [];
		sends = 0;
		sentHeaders = [];
		store = new SyncStore();
		store.account = createSyncIdentity();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends a round again after the relay was not reached', async () => {
		replies = [{ network: true }, { status: 502 }, { status: 200, body: { cursor: 3 } }];
		const result = await send(store);
		expect(result).toMatchObject({ success: true, data: { cursor: 3 } });
		expect(sends).toBe(3);
	});

	it('stops after three retries and reports the last failure', async () => {
		replies = Array.from({ length: 6 }, () => ({
			status: 503,
			body: { error: 'Sync storage is temporarily unavailable' }
		}));
		const result = await send(store);
		expect(result).toMatchObject({
			success: false,
			status: 503,
			error: 'Sync storage is temporarily unavailable'
		});
		expect(sends).toBe(4);
	});

	it('leaves a requested wait to the sync loop', async () => {
		replies = [
			{ status: 503, body: { error: 'Sync server is busy' }, headers: { 'retry-after': '2' } }
		];
		const result = await send(store);
		expect(result).toMatchObject({ success: false, status: 503, retryAfterSeconds: 2 });
		expect(sends).toBe(1);
	});

	it('never repeats a refusal', async () => {
		replies = [{ status: 507, body: { error: 'Sync account storage quota exceeded' } }];
		const result = await send(store);
		expect(result).toMatchObject({ success: false, status: 507 });
		expect(sends).toBe(1);
	});

	it('sends the protocol version and does not retry an upgrade refusal', async () => {
		replies = [
			{
				status: 409,
				body: {
					error: 'Sync protocol version mismatch. Reload the app or update the MCP server.',
					requiredVersion: SYNC_PROTOCOL_VERSION
				}
			}
		];

		const result = await send(store);

		expect(result).toMatchObject({ success: false, status: 409 });
		expect(sentHeaders).toHaveLength(1);
		expect(sentHeaders[0][SYNC_PROTOCOL_HEADER]).toBe(SYNC_PROTOCOL_VERSION);
		expect(sends).toBe(1);
	});

	it('surfaces an update hint when an older relay does not have the v2 route', async () => {
		replies = [{ status: 404, body: { error: 'Not Found' } }];

		const result = await send(store);

		expect(result).toMatchObject({
			success: false,
			status: 404,
			error: 'The sync server needs an update to support this app version.'
		});
		expect(sends).toBe(1);
	});

	it('drops the retry once the workspace leaves this account', async () => {
		replies = [{ network: true }, { status: 200, body: {} }];
		const pending = transport(store).sendSyncRequest(SYNC_DELTA_PATH, '{}', 2, false);
		await vi.advanceTimersByTimeAsync(0);
		store.account = createSyncIdentity();
		await vi.runAllTimersAsync();
		expect(await pending).toMatchObject({ success: false, error: 'Sync was cancelled' });
		expect(sends).toBe(1);
	});
});
