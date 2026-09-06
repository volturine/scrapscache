import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncIdentity } from '$lib/syncPairing';
import { notesStore } from './notes.svelte';
import { syncStore } from './sync.svelte';

describe('heuristic sync triggers and coalescing', () => {
	beforeEach(() => {
		localStorage.clear();
		vi.restoreAllMocks();
		notesStore.notes = [];
		notesStore.labels = [];
		(notesStore as unknown as { lastAutoSyncAt: number }).lastAutoSyncAt = 0;
		syncStore.account = createSyncIdentity();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function mockRelay(requests: unknown[], delayMs = 0): void {
		vi.spyOn(
			syncStore as unknown as {
				sendSyncRequest(
					path: string,
					payload: string
				): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>;
			},
			'sendSyncRequest'
		).mockImplementation(async (_path, payload) => {
			if (delayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, delayMs));
			}
			requests.push(JSON.parse(payload) as { cursor: number });
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

	it('triggerSync bypasses opportunistic interval throttle', async () => {
		const requests: unknown[] = [];
		mockRelay(requests, 0);

		// Perform initial bootstrap sync
		await notesStore.triggerSync();
		const bootstrapCount = requests.length;

		// Set lastAutoSyncAt to now to simulate recent sync
		(notesStore as unknown as { lastAutoSyncAt: number }).lastAutoSyncAt = Date.now();

		// Normal syncWithCloud() should be throttled
		await notesStore.syncWithCloud();
		expect(requests.length).toBe(bootstrapCount);

		// Explicit heuristic triggerSync() must NOT be throttled
		await notesStore.triggerSync();
		expect(requests.length).toBeGreaterThan(bootstrapCount);
	});

	it('coalesces multiple concurrent triggerSync calls into a single follow-up run', async () => {
		const requests: unknown[] = [];
		mockRelay(requests, 30);

		// Perform initial bootstrap sync
		await notesStore.triggerSync();
		const baseCount = requests.length;

		// Trigger first sync
		const p1 = notesStore.triggerSync();

		// While first sync is in-flight, send multiple rapid triggers (e.g. 5 SSE notifications)
		const p2 = notesStore.triggerSync();
		const p3 = notesStore.triggerSync();
		const p4 = notesStore.triggerSync();
		const p5 = notesStore.triggerSync();

		await Promise.all([p1, p2, p3, p4, p5]);

		// All 5 triggers should collapse: 1 initial flight + exactly 1 follow-up flight = 2 requests
		expect(requests.length - baseCount).toBe(2);
	});

	it('posts local-sync-complete message to BroadcastChannel on successful sync', async () => {
		const requests: unknown[] = [];
		mockRelay(requests, 0);

		const postMessageSpy = vi.fn();
		(
			notesStore as unknown as {
				syncBroadcastChannel: { postMessage: (msg: unknown) => void } | null;
			}
		).syncBroadcastChannel = { postMessage: postMessageSpy };

		await notesStore.triggerSync();

		expect(postMessageSpy).toHaveBeenCalledWith({ type: 'local-sync-complete' });
	});
});
