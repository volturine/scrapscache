import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderHistoryClient } from './reminderHistoryClient';
import { ReminderHistoryStore } from './stores/reminderHistory';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});
function setup() {
	let profiles = [{ id: 'event-workspace', syncKey: 'test-key' }];
	const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
	const signals: AbortSignal[] = [];
	const connect = vi.fn(async (_profile: unknown, signal?: AbortSignal) => {
		signals.push(signal!);
		return new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controllers.push(controller);
					controller.enqueue(new TextEncoder().encode(': connected\n\n'));
				}
			})
		);
	});
	const history = new ReminderHistoryStore();
	const client = new ReminderHistoryClient(history, () => profiles, vi.fn(), connect);
	const exchange = vi.spyOn(client, 'exchange').mockResolvedValue(undefined);
	return {
		client,
		history,
		exchange,
		connect,
		controllers,
		signals,
		setProfiles: (next: typeof profiles) => {
			profiles = next;
			client.updateProfiles();
		}
	};
}
describe('event-driven reminder receipts', () => {
	it('catches up on connect and events, with no periodic receipt requests', async () => {
		const { client, exchange, controllers } = setup();
		const stop = client.attach();
		try {
			await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(1));
			await vi.advanceTimersByTimeAsync(10 * 60_000);
			expect(exchange).toHaveBeenCalledTimes(1);
			controllers[0].enqueue(new TextEncoder().encode('data: {}\n\n'));
			await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(2));
		} finally {
			stop();
		}
	});
	it('catches up again after disconnect, without a receipt polling timer', async () => {
		const { client, exchange, controllers, connect } = setup();
		const stop = client.attach();
		try {
			await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(1));
			controllers[0].close();
			await vi.advanceTimersByTimeAsync(2000);
			await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
			expect(exchange).toHaveBeenCalledTimes(2);
		} finally {
			stop();
		}
	});
	it('retries failed receipt delivery even if the SSE connection stays healthy', async () => {
		const { client, exchange } = setup();
		exchange.mockRejectedValueOnce(new Error('temporary outage'));
		const stop = client.attach();
		try {
			await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(1));
			await vi.advanceTimersByTimeAsync(2000);
			expect(exchange).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(exchange).toHaveBeenCalledTimes(2);
		} finally {
			stop();
		}
	});
	it('replaces changed identities and stops removed workspaces and pending retries', async () => {
		const { client, exchange, signals, connect, setProfiles } = setup();
		const stop = client.attach();
		try {
			await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(1));
			setProfiles([{ id: 'event-workspace', syncKey: 'replacement' }]);
			await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
			expect(signals[0].aborted).toBe(true);
			exchange.mockRejectedValueOnce(new Error('offline'));
			window.dispatchEvent(new Event('focus'));
			await vi.advanceTimersByTimeAsync(0);
			setProfiles([]);
			expect(signals[1].aborted).toBe(true);
			const requests = exchange.mock.calls.length;
			await vi.advanceTimersByTimeAsync(60_000);
			expect(exchange).toHaveBeenCalledTimes(requests);
		} finally {
			stop();
		}
	});
});
