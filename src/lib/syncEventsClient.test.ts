import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncEventsClient, type SyncStoreLike } from './syncEventsClient';

describe('SyncEventsClient', () => {
	let mockSyncStore: SyncStoreLike;

	beforeEach(() => {
		vi.useFakeTimers();
		mockSyncStore = {
			isLoggedIn: true,
			authorizedFetch: vi.fn()
		};
	});

	it('connects and dispatches sync events to subscribers', async () => {
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(': ok\n\n'));
				controller.enqueue(encoder.encode('data: {"seq": 10}\n\n'));
			}
		});

		(mockSyncStore.authorizedFetch as any).mockResolvedValueOnce(
			new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
		);

		const client = new SyncEventsClient(mockSyncStore);
		const listener = vi.fn();
		client.subscribe(listener);

		// Allow microtasks and stream reads to flush
		await vi.waitFor(() => {
			expect(listener).toHaveBeenCalledWith(10);
		});

		client.destroy();
	});

	it('stops connection when unsubscribed', () => {
		const client = new SyncEventsClient(mockSyncStore);
		const listener = vi.fn();
		const unsub = client.subscribe(listener);

		expect((client as any).active).toBe(true);
		unsub();
		expect((client as any).active).toBe(false);

		client.destroy();
	});

	it('does not connect when user is not logged in', () => {
		mockSyncStore = {
			isLoggedIn: false,
			authorizedFetch: vi.fn()
		};
		const client = new SyncEventsClient(mockSyncStore);
		const listener = vi.fn();
		client.subscribe(listener);

		expect(mockSyncStore.authorizedFetch).not.toHaveBeenCalled();
		client.destroy();
	});
});
