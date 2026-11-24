import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notesStore } from './notes.svelte';
import { syncStore } from './sync.svelte';
import { relay } from '#lib/relayClient.js';
import { CAUGHT_UP_MS, syncScheduler } from './syncScheduler';
import { linkTestWorkspace, unlinkTestWorkspace } from '../../tests/syncing';

describe('heuristic sync triggers and coalescing', () => {
	beforeEach(async () => {
		localStorage.clear();
		vi.restoreAllMocks();
		notesStore.notes = [];
		notesStore.loaded = true;
		notesStore.labels = [];
		await syncScheduler.reset();
		linkTestWorkspace();
		// Loaded as the app loads it, so its first board is saved and queued like any other.
		await notesStore.reloadForProfile();
	});

	afterEach(async () => {
		vi.useRealTimers();
		await syncScheduler.reset();
		unlinkTestWorkspace();
	});

	function mockRelay(requests: unknown[], delayMs = 0): void {
		vi.spyOn(
			relay as unknown as {
				sendSyncRequest(
					path: string,
					payload: string
				): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
			},
			'sendSyncRequest'
		).mockImplementation(async (_path, payload) => {
			requests.push(JSON.parse(payload) as { cursor: number });
			if (delayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, delayMs));
			}
			return {
				success: true,
				data: {
					cursor: requests.length,
					envelopes: [],
					conflicts: [],
					hasMore: false,
					reset: false,
					writesAccepted: true
				}
			};
		});
	}

	it('a request for a sync is not held back by the catch-up throttle', async () => {
		const requests: unknown[] = [];
		mockRelay(requests, 0);

		// Perform initial bootstrap sync
		await syncScheduler.request(syncStore.activeId);
		const bootstrapCount = requests.length;

		// The workspace has just synced, so a catch-up is throttled
		await syncScheduler.catchUp(syncStore.activeId, CAUGHT_UP_MS);
		expect(requests.length).toBe(bootstrapCount);

		// An explicit request for a sync must NOT be throttled
		await syncScheduler.request(syncStore.activeId);
		expect(requests.length).toBeGreaterThan(bootstrapCount);
	});

	it('coalesces multiple concurrent sync requests into a single follow-up run', async () => {
		const requests: unknown[] = [];
		mockRelay(requests, 30);

		// Perform initial bootstrap sync
		await syncScheduler.request(syncStore.activeId);
		const baseCount = requests.length;

		// Trigger first sync
		const p1 = syncScheduler.request(syncStore.activeId);
		await vi.waitFor(() => expect(requests.length).toBe(baseCount + 1), { interval: 1 });

		// While first sync is in-flight, send multiple rapid triggers (e.g. 5 SSE notifications)
		const p2 = syncScheduler.request(syncStore.activeId);
		const p3 = syncScheduler.request(syncStore.activeId);
		const p4 = syncScheduler.request(syncStore.activeId);
		const p5 = syncScheduler.request(syncStore.activeId);

		await Promise.all([p1, p2, p3, p4, p5]);

		// All 5 triggers should collapse: 1 initial flight + exactly 1 follow-up flight = 2 requests
		expect(requests.length - baseCount).toBe(2);
	});

	// On a connection that does not reach the relay, whoever asks for a sync while
	// one is running is answered when that one fails, not a whole round later.
	it('does not send a failed round again for the syncs that joined it', async () => {
		let requests = 0;
		vi.spyOn(
			relay as unknown as {
				sendSyncRequest(): Promise<{ success: boolean; error?: string }>;
			},
			'sendSyncRequest'
		).mockImplementation(async () => {
			requests += 1;
			await new Promise((resolve) => setTimeout(resolve, 30));
			return { success: false, error: 'Sync network error' };
		});

		const running = syncScheduler.request(syncStore.activeId);
		const joined = syncScheduler.request(syncStore.activeId);

		expect(await Promise.all([running, joined])).toEqual([false, false]);
		expect(requests).toBe(1);
	});

	it('posts local-sync-complete message to BroadcastChannel on successful sync', async () => {
		const requests: unknown[] = [];
		mockRelay(requests, 0);

		const postMessageSpy = vi.fn();
		const windows = syncScheduler as unknown as {
			channel: { postMessage: (msg: unknown) => void } | null;
		};
		const channel = windows.channel;
		windows.channel = { postMessage: postMessageSpy };
		try {
			await syncScheduler.request(syncStore.activeId);
		} finally {
			windows.channel = channel;
		}

		expect(postMessageSpy).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'local-sync-complete' })
		);
	});
});
