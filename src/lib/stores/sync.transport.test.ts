import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	SYNC_DELTA_PATH,
	SYNC_PROTOCOL_HEADER,
	SYNC_PROTOCOL_VERSION
} from '#lib/model/protocol.js';
import { DEFAULT_SERVER_ORIGIN } from '#lib/serverOrigin.svelte.js';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { STALE_MODULE_RELOAD_KEY } from '#lib/staleModuleReload.js';
import { SyncStore, serverChanged, syncEventsClient, syncStore } from './sync.svelte';
import { SYNC_VERSION_MISMATCH_MESSAGE, relay } from '#lib/relayClient.js';
import { syncParts } from '../../tests/openSync';

type Reply =
	| { network: true }
	// The relay never answers: the request ends only when it is dropped.
	| { silent: true }
	| { status: number; body?: Record<string, unknown>; headers?: Record<string, string> };

const native = vi.hoisted(() => ({ on: false }));
vi.mock('#lib/native.js', () => ({ isNativeApp: () => native.on }));

let replies: Reply[] = [];
let opened: string[] = [];
let sends = 0;
let sentHeaders: Record<string, string>[] = [];
let dropped = 0;
let lastXhr: FakeXhr | null = null;

/** Answers each send with the next scripted reply, the way the browser reports it. */
class FakeXhr {
	status = 0;
	responseText = '';
	timeout = 0;
	upload: { onprogress: (() => void) | null } = { onprogress: null };
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	ontimeout: (() => void) | null = null;
	onabort: (() => void) | null = null;
	onprogress: ((event: { lengthComputable: boolean }) => void) | null = null;
	onloadend: (() => void) | null = null;
	private headers: Record<string, string> = {};
	open(_method: string, url: string): void {
		opened.push(url);
	}
	setRequestHeader(name: string, value: string): void {
		this.headers[name.toLowerCase()] = value;
	}
	getResponseHeader(name: string): string | null {
		return this.headers[name.toLowerCase()] ?? null;
	}
	send(): void {
		lastXhr = this;
		sends += 1;
		sentHeaders.push({ ...this.headers });
		const reply = replies.shift() ?? { status: 200, body: {} };
		if ('silent' in reply) return;
		queueMicrotask(() => {
			if ('network' in reply) return this.onerror?.();
			this.status = reply.status;
			this.responseText = JSON.stringify(reply.body ?? {});
			this.headers = reply.headers ?? {};
			this.onload?.();
		});
	}
	abort(): void {
		dropped += 1;
		this.onabort?.();
		this.onloadend?.();
	}
}

/** The request is for a workspace this window does not show. */
const hidden = () => false;

type Transport = {
	sendSyncRequest(
		path: string,
		payload: string,
		uploadBytes: number,
		shown: () => boolean,
		account?: unknown,
		signal?: AbortSignal,
		cancelled?: () => boolean
	): Promise<{ success: boolean; status?: number; error?: string; retryAfterSeconds?: number }>;
	accessToken(): Promise<string>;
};

function transport(store: SyncStore): Transport {
	const relay = syncParts(store).relay as unknown as Transport;
	vi.spyOn(relay, 'accessToken').mockResolvedValue('token');
	return relay;
}

async function send(store: SyncStore) {
	const pending = transport(store).sendSyncRequest(SYNC_DELTA_PATH, '{}', 2, hidden, store.account);
	await vi.runAllTimersAsync();
	return pending;
}

describe('sync transport', () => {
	let store: SyncStore;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('XMLHttpRequest', FakeXhr);
		native.on = false;
		replies = [];
		opened = [];
		sends = 0;
		sentHeaders = [];
		dropped = 0;
		lastXhr = null;
		store = new SyncStore();
		store.account = createSyncIdentity();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends a round to the page origin on the web, and to the named server in the app', async () => {
		await send(store);
		expect(opened).toEqual([SYNC_DELTA_PATH]);

		native.on = true;
		opened = [];
		await send(store);
		expect(opened).toEqual([`${DEFAULT_SERVER_ORIGIN}${SYNC_DELTA_PATH}`]);
	});

	it('forgets sign-ins and sync state, and reconnects, when the server setting moves', async () => {
		const held = relay as unknown as {
			sessions: Map<string, unknown>;
			pendingSessions: Map<string, unknown>;
		};
		held.sessions.set('a', { accessToken: 'old-server', expiresAt: Date.now() + 60_000 });
		held.pendingSessions.set('a', Promise.resolve('old-server'));
		const workspace = {
			id: 'moved-server',
			name: 'Moved',
			syncKey: createSyncIdentity().syncKey,
			createdAt: 1
		};
		const before = syncStore.profiles;
		syncStore.profiles = [...before, workspace];
		syncStore.state(workspace.id).lastError = 'The old server said no';
		const accountChanged = vi.spyOn(syncEventsClient, 'accountChanged');
		try {
			serverChanged();

			expect(held.sessions.size).toBe(0);
			expect(held.pendingSessions.size).toBe(0);
			expect(syncStore.stateOf(workspace.id).lastError).toBeNull();
			expect(accountChanged).toHaveBeenCalledOnce();
		} finally {
			syncStore.profiles = before;
		}
		// The store's own device reads run on the faked clock.
		await vi.runAllTimersAsync();
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

	// A sync that gives up its round for a rewrite of its workspace must not hold the
	// sync lock for as long as a poor connection takes to answer, or to fail.
	describe('a round its sync gave up', () => {
		const giveUp = new DOMException('The sync gave up its round.', 'AbortError');
		// The store's own device reads run on the faked clock; the answers above do not.
		const settleDeviceReads = () => vi.runAllTimersAsync();

		it('drops a request the relay has not answered', async () => {
			replies = [{ silent: true }];
			const round = new AbortController();
			const pending = transport(store).sendSyncRequest(
				SYNC_DELTA_PATH,
				'{}',
				2,
				hidden,
				store.account,
				round.signal
			);
			await vi.advanceTimersByTimeAsync(0);
			expect(sends).toBe(1);

			round.abort(giveUp);

			expect(await pending).toMatchObject({ success: false, error: 'Sync was cancelled' });
			expect(dropped).toBe(1);
			expect(sends).toBe(1);
			await settleDeviceReads();
		});

		it('stops waiting for a sign-in the relay has not answered', async () => {
			const internals = syncParts(store).relay as unknown as Transport;
			vi.spyOn(internals, 'accessToken').mockReturnValue(new Promise(() => undefined));
			const round = new AbortController();
			const pending = internals.sendSyncRequest(
				SYNC_DELTA_PATH,
				'{}',
				2,
				hidden,
				store.account,
				round.signal
			);
			await vi.advanceTimersByTimeAsync(0);

			round.abort(giveUp);

			expect(await pending).toMatchObject({ success: false });
			expect(sends).toBe(0);
			await settleDeviceReads();
		});

		it('does not wait out the delay before a retry, or send again', async () => {
			replies = [{ network: true }];
			const round = new AbortController();
			const pending = transport(store).sendSyncRequest(
				SYNC_DELTA_PATH,
				'{}',
				2,
				hidden,
				store.account,
				round.signal
			);
			await vi.advanceTimersByTimeAsync(0);
			expect(sends).toBe(1);

			round.abort(giveUp);

			// No timer is advanced: the answer comes without the retry delay passing.
			expect(await pending).toMatchObject({ success: false, error: 'Sync was cancelled' });
			expect(sends).toBe(1);
			await settleDeviceReads();
		});
	});

	// On a connection that is up in name only the relay neither answers nor fails.
	describe('a request the relay goes silent on', () => {
		const sendSilent = async () => {
			replies = [{ silent: true }];
			const pending = transport(store).sendSyncRequest(
				SYNC_DELTA_PATH,
				'{}',
				2,
				hidden,
				store.account
			);
			await vi.advanceTimersByTimeAsync(0);
			expect(sends).toBe(1);
			return pending;
		};

		it('is given up after a minute with nothing moving, and not sent again', async () => {
			const pending = sendSilent();
			await vi.advanceTimersByTimeAsync(59_000);
			expect(dropped).toBe(0);

			await vi.advanceTimersByTimeAsync(1_000);

			expect(await pending).toMatchObject({ success: false, error: 'Sync timed out' });
			expect(dropped).toBe(1);
			await vi.runAllTimersAsync();
			expect(sends).toBe(1);
		});

		it('is left to finish for as long as bytes keep moving', async () => {
			const pending = sendSilent();
			await vi.advanceTimersByTimeAsync(0);
			for (let step = 0; step < 6; step += 1) {
				await vi.advanceTimersByTimeAsync(50_000);
				if (step % 2) lastXhr?.onprogress?.({ lengthComputable: false });
				else lastXhr?.upload.onprogress?.();
			}
			expect(dropped).toBe(0);

			await vi.advanceTimersByTimeAsync(60_000);
			expect(await pending).toMatchObject({ success: false, error: 'Sync timed out' });
			expect(dropped).toBe(1);
		});

		// A photo on a weak signal takes as long as it takes: given up at a fixed
		// time it would start again from nothing, every time.
		it('lets a transfer finish however long it takes while it keeps moving', async () => {
			const pending = sendSilent();
			await vi.advanceTimersByTimeAsync(0);
			for (let second = 0; second < 6 * 60; second += 30) {
				await vi.advanceTimersByTimeAsync(30_000);
				lastXhr?.upload.onprogress?.();
			}
			expect(dropped).toBe(0);

			const xhr = lastXhr!;
			xhr.status = 200;
			xhr.responseText = JSON.stringify({ cursor: 7 });
			xhr.onload?.();

			expect(await pending).toMatchObject({ success: true, data: { cursor: 7 } });
			expect(sends).toBe(1);
			await vi.runAllTimersAsync();
			expect(dropped).toBe(0);
		});

		it('gives up a sign-in the relay never answers', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn(
					(_input: RequestInfo | URL, init?: RequestInit) =>
						new Promise<Response>((_resolve, reject) =>
							init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
						)
				)
			);
			const pending = (syncParts(store).relay as unknown as Transport).sendSyncRequest(
				SYNC_DELTA_PATH,
				'{}',
				2,
				hidden,
				store.account
			);
			await vi.advanceTimersByTimeAsync(60_000);

			expect(await pending).toMatchObject({ success: false, error: 'Sync timed out' });
			expect(sends).toBe(0);
			await vi.runAllTimersAsync();
		});
	});

	it('never repeats a refusal', async () => {
		replies = [{ status: 507, body: { error: 'Sync account storage quota exceeded' } }];
		const result = await send(store);
		expect(result).toMatchObject({ success: false, status: 507 });
		expect(sends).toBe(1);
	});

	it('sends the protocol version and returns the actionable error for a newer relay', async () => {
		const reload = vi.fn();
		vi.stubGlobal('location', { reload });
		replies = [
			{
				status: 409,
				body: {
					error: 'Sync protocol version mismatch. Reload the app or update the MCP server.',
					requiredVersion: String(Number(SYNC_PROTOCOL_VERSION) + 1)
				}
			}
		];

		const result = await send(store);

		expect(result).toMatchObject({
			success: false,
			status: 409,
			error: SYNC_VERSION_MISMATCH_MESSAGE
		});
		expect(sentHeaders).toHaveLength(1);
		expect(sentHeaders[0][SYNC_PROTOCOL_HEADER]).toBe(SYNC_PROTOCOL_VERSION);
		expect(sends).toBe(1);
		expect(reload).not.toHaveBeenCalled();
	});

	it('returns the same actionable error when the relay requires an older protocol', async () => {
		const reload = vi.fn();
		vi.stubGlobal('location', { reload });
		replies = [
			{
				status: 409,
				body: {
					error: 'Sync protocol version mismatch. Reload the app or update the MCP server.',
					requiredVersion: String(Number(SYNC_PROTOCOL_VERSION) - 1)
				}
			}
		];

		const result = await send(store);

		expect(result).toMatchObject({
			success: false,
			status: 409,
			error: SYNC_VERSION_MISMATCH_MESSAGE
		});
		expect(sends).toBe(1);
		expect(reload).not.toHaveBeenCalled();
	});

	it('keeps repeated mismatch responses actionable beyond the missing-module cooldown', async () => {
		const reload = vi.fn();
		vi.stubGlobal('location', { reload });
		const previousReload = String(Date.now());
		sessionStorage.setItem(STALE_MODULE_RELOAD_KEY, previousReload);
		replies = Array.from({ length: 3 }, () => ({
			status: 409,
			body: { requiredVersion: String(Number(SYNC_PROTOCOL_VERSION) + 1) }
		}));

		for (let attempt = 0; attempt < 3; attempt += 1) {
			if (attempt > 0) await vi.advanceTimersByTimeAsync(15_001);
			expect(await send(store)).toMatchObject({
				success: false,
				status: 409,
				error: SYNC_VERSION_MISMATCH_MESSAGE
			});
		}

		expect(sends).toBe(3);
		expect(sessionStorage.getItem(STALE_MODULE_RELOAD_KEY)).toBe(previousReload);
		expect(reload).not.toHaveBeenCalled();
	});

	it('does not try to reload a mismatch when session storage is unavailable', async () => {
		const reload = vi.fn();
		vi.stubGlobal('location', { reload });
		const getItem = vi.fn(() => {
			throw new Error('Storage is unavailable');
		});
		const setItem = vi.fn(() => {
			throw new Error('Storage is unavailable');
		});
		vi.stubGlobal('sessionStorage', { getItem, setItem, clear: vi.fn() });
		replies = [
			{
				status: 409,
				body: { requiredVersion: String(Number(SYNC_PROTOCOL_VERSION) + 1) }
			}
		];

		expect(await send(store)).toMatchObject({
			success: false,
			status: 409,
			error: SYNC_VERSION_MISMATCH_MESSAGE
		});
		expect(getItem).not.toHaveBeenCalled();
		expect(setItem).not.toHaveBeenCalled();
		expect(reload).not.toHaveBeenCalled();
	});

	it('does not translate a 409 that requires this protocol version', async () => {
		replies = [
			{
				status: 409,
				body: {
					error: 'This sync request was rejected.',
					requiredVersion: SYNC_PROTOCOL_VERSION
				}
			}
		];

		const result = await send(store);

		expect(result).toMatchObject({
			success: false,
			status: 409,
			error: 'This sync request was rejected.'
		});
		expect(sends).toBe(1);
	});

	it('does not translate a non-409 response with a different required version', async () => {
		replies = [
			{
				status: 400,
				body: {
					error: 'Malformed sync request.',
					requiredVersion: String(Number(SYNC_PROTOCOL_VERSION) + 1)
				}
			}
		];

		const result = await send(store);

		expect(result).toMatchObject({
			success: false,
			status: 400,
			error: 'Malformed sync request.'
		});
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
		const account = store.account;
		// The sync that sent the request decides when it is given up.
		const pending = transport(store).sendSyncRequest(
			SYNC_DELTA_PATH,
			'{}',
			2,
			hidden,
			account,
			undefined,
			() => store.account !== account
		);
		await vi.advanceTimersByTimeAsync(0);
		store.account = createSyncIdentity();
		await vi.runAllTimersAsync();
		expect(await pending).toMatchObject({ success: false, error: 'Sync was cancelled' });
		expect(sends).toBe(1);
	});
});
