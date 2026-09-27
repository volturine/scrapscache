import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderHistoryClient, ReminderStorageFullError } from './reminderHistoryClient';
import { ReminderHistoryStore } from './stores/reminderHistory';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});
function setup() {
	let profiles = [{ id: 'event-workspace', syncKey: 'test-key' }];
	let active = 'event-workspace';
	const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
	const signals: AbortSignal[] = [];
	const connect = vi.fn(
		async (_profile: { id: string }, _clientId: string, signal?: AbortSignal) => {
			signals.push(signal!);
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controllers.push(controller);
						controller.enqueue(new TextEncoder().encode(': connected\n\n'));
					}
				})
			);
		}
	);
	const history = new ReminderHistoryStore();
	const client = new ReminderHistoryClient(
		history,
		() => profiles,
		() => active,
		vi.fn(),
		connect
	);
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
		},
		activate: (id: string) => {
			active = id;
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
	it('watches only the open workspace and moves the stream when it changes', async () => {
		const { client, connect, signals, setProfiles, activate } = setup();
		setProfiles([
			{ id: 'event-workspace', syncKey: 'test-key' },
			{ id: 'background', syncKey: 'other-key' }
		]);
		const stop = client.attach();
		try {
			await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
			expect(connect.mock.calls[0][0].id).toBe('event-workspace');
			expect(connect.mock.calls[0][1]).toBe(client.clientId);
			activate('background');
			await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
			expect(signals[0].aborted).toBe(true);
			expect(connect.mock.calls[1][0].id).toBe('background');
			activate('local-only');
			expect(signals[1].aborted).toBe(true);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(connect).toHaveBeenCalledTimes(2);
		} finally {
			stop();
		}
	});
	it('sends what a background workspace has queued, without watching it', async () => {
		const { client, history, exchange, connect, setProfiles } = setup();
		setProfiles([
			{ id: 'event-workspace', syncKey: 'test-key' },
			{ id: 'queued', syncKey: 'other-key' },
			{ id: 'idle', syncKey: 'third-key' }
		]);
		vi.spyOn(history, 'hasPending').mockImplementation(async (pid) => pid === 'queued');
		const stop = client.attach();
		try {
			await vi.waitFor(() => expect(exchange).toHaveBeenCalledWith('queued'));
			expect(exchange).not.toHaveBeenCalledWith('idle');
			expect(connect).toHaveBeenCalledTimes(1);
		} finally {
			stop();
		}
	});
	it('does not retry while the relay storage is full', async () => {
		const { client, exchange } = setup();
		exchange.mockRejectedValue(new ReminderStorageFullError());
		const stop = client.attach();
		try {
			await vi.waitFor(() => expect(exchange).toHaveBeenCalled());
			const calls = exchange.mock.calls.length;
			await vi.advanceTimersByTimeAsync(10 * 60_000);
			expect(exchange).toHaveBeenCalledTimes(calls);
		} finally {
			stop();
		}
	});
});
