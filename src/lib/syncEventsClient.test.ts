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

	it('pulls once whenever a connection opens, since nothing signalled changes in between', async () => {
		const fetch = mockSyncStore.authorizedFetch as ReturnType<typeof vi.fn>;
		fetch.mockImplementationOnce(
			async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode('data: {"seq": 4}\n\n'));
							controller.close();
						}
					})
				)
		);
		fetch.mockImplementation(async () => new Response(new ReadableStream()));
		const client = new SyncEventsClient(mockSyncStore);
		const listener = vi.fn();
		client.subscribe(listener);

		await vi.advanceTimersByTimeAsync(0);
		expect(listener.mock.calls).toEqual([[], [4]]);

		// The stream ended; the next connection catches up on what it missed.
		await vi.advanceTimersByTimeAsync(2_500);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(listener.mock.calls).toEqual([[], [4], []]);
		client.destroy();
	});

	it('does not pull for a connection that never opened', async () => {
		(mockSyncStore.authorizedFetch as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error('offline')
		);
		const client = new SyncEventsClient(mockSyncStore);
		const listener = vi.fn();
		client.subscribe(listener);

		await vi.advanceTimersByTimeAsync(5_000);
		expect(listener).not.toHaveBeenCalled();
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

	it('replaces an active event stream when the sync account changes', async () => {
		const signals: AbortSignal[] = [];
		(mockSyncStore.authorizedFetch as ReturnType<typeof vi.fn>).mockImplementation(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				const signal = init?.signal as AbortSignal;
				signals.push(signal);
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode(': ok\n\n'));
						signal.addEventListener('abort', () => controller.close(), { once: true });
					}
				});
				return new Response(stream);
			}
		);
		const client = new SyncEventsClient(mockSyncStore);
		client.subscribe(() => undefined);
		await vi.waitFor(() => expect(signals).toHaveLength(1));

		client.accountChanged();

		await vi.waitFor(() => expect(signals).toHaveLength(2));
		expect(signals[0].aborted).toBe(true);
		expect(signals[1].aborted).toBe(false);
		client.destroy();
	});

	it('backs off between connections that never open, and stops when no longer wanted', async () => {
		const fetch = mockSyncStore.authorizedFetch as ReturnType<typeof vi.fn>;
		fetch.mockRejectedValue(new Error('offline'));
		const client = new SyncEventsClient(mockSyncStore);
		client.subscribe(() => undefined);
		await vi.advanceTimersByTimeAsync(0);
		expect(fetch).toHaveBeenCalledTimes(1);

		// About 2s, then about 3s more, each ±20%: the second attempt lands within
		// 1.6–2.4s and the third within 4.0–6.0s.
		await vi.advanceTimersByTimeAsync(1_500);
		expect(fetch).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(fetch).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1_400);
		expect(fetch).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(2_200);
		expect(fetch).toHaveBeenCalledTimes(3);

		client.destroy();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('reconnects shortly after an open stream ends, with the backoff started over', async () => {
		const fetch = mockSyncStore.authorizedFetch as ReturnType<typeof vi.fn>;
		fetch.mockImplementation(
			async () => new Response(new ReadableStream({ start: (c) => c.close() }))
		);
		const client = new SyncEventsClient(mockSyncStore);
		client.subscribe(() => undefined);
		await vi.advanceTimersByTimeAsync(0);
		expect(fetch).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1_500);
		expect(fetch).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(fetch).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(2_500);
		expect(fetch).toHaveBeenCalledTimes(3);
		client.destroy();
	});
});
