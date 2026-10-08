import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { syncClock } from '#lib/editContext.js';
import { SyncStore } from './sync.svelte';

type Reply = { status: number; body?: Record<string, unknown> };

let replies: Reply[] = [];

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
	open(): void {}
	setRequestHeader(): void {}
	getResponseHeader(): string | null {
		return null;
	}
	send(): void {
		const reply = replies.shift() ?? { status: 200, body: {} };
		queueMicrotask(() => {
			this.status = reply.status;
			this.responseText = JSON.stringify(reply.body ?? {});
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
	): Promise<{ success: boolean }>;
	accessToken(): Promise<string>;
};

async function send(store: SyncStore) {
	const internals = store as unknown as Transport;
	vi.spyOn(internals, 'accessToken').mockResolvedValue('token');
	const pending = internals.sendSyncRequest('/api/sync/delta', '{}', 2, false);
	await vi.runAllTimersAsync();
	return pending;
}

describe('relay clock from sync replies', () => {
	let store: SyncStore;

	beforeEach(() => {
		vi.useFakeTimers({ now: 1_000_000 });
		vi.stubGlobal('XMLHttpRequest', FakeXhr);
		replies = [];
		syncClock.offset = 0;
		store = new SyncStore();
		store.account = createSyncIdentity();
	});

	afterEach(() => {
		syncClock.offset = 0;
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('takes the relay time from a successful reply', async () => {
		replies = [{ status: 200, body: { cursor: 1, serverTime: 1_060_000 } }];
		await expect(send(store)).resolves.toMatchObject({ success: true });
		expect(syncClock.offset).toBe(60_000);
	});

	it('leaves the clock alone when the reply is an error', async () => {
		replies = [{ status: 500, body: { error: 'relay error', serverTime: 1_060_000 } }];
		await expect(send(store)).resolves.toMatchObject({ success: false, status: 500 });
		expect(syncClock.offset).toBe(0);
	});

	it('leaves the clock alone when the reply names no time', async () => {
		replies = [{ status: 200, body: { cursor: 1 } }];
		await expect(send(store)).resolves.toMatchObject({ success: true });
		expect(syncClock.offset).toBe(0);
	});
});
