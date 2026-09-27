import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderHistoryClient, ReminderStorageFullError } from './reminderHistoryClient';
import { ReminderHistoryStore } from './stores/reminderHistory';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});
function setup() {
	let profiles = [
		{ id: 'open', syncKey: 'open-key' },
		{ id: 'queued', syncKey: 'queued-key' },
		{ id: 'idle', syncKey: 'idle-key' },
		{ id: 'private', syncKey: '' }
	];
	const history = new ReminderHistoryStore();
	vi.spyOn(history, 'hasPending').mockImplementation(async (pid) => pid === 'queued');
	const client = new ReminderHistoryClient(
		history,
		() => profiles,
		() => 'open',
		vi.fn()
	);
	const exchange = vi.spyOn(client, 'exchange').mockResolvedValue(undefined);
	return {
		client,
		history,
		exchange,
		setProfiles: (next: typeof profiles) => {
			profiles = next;
		}
	};
}
const calls = (exchange: ReturnType<typeof setup>['exchange']) =>
	exchange.mock.calls.map(([pid]) => pid).sort();

describe('receipt exchanges without a connection', () => {
	it('catches up the open workspace and sends only queued ones, with no timer afterwards', async () => {
		const { client, exchange } = setup();
		const stop = client.attach();
		try {
			await vi.waitFor(() => expect(calls(exchange)).toEqual(['open', 'queued']));
			await vi.advanceTimersByTimeAsync(60 * 60_000);
			expect(calls(exchange)).toEqual(['open', 'queued']);
		} finally {
			stop();
		}
	});
	it('exchanges again when the app is shown, focused or back online, once per return', async () => {
		const { client, exchange } = setup();
		const stop = client.attach();
		try {
			await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(2));
			await vi.advanceTimersByTimeAsync(5000);
			window.dispatchEvent(new Event('focus'));
			document.dispatchEvent(new Event('visibilitychange'));
			await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(4));
			await vi.advanceTimersByTimeAsync(5000);
			window.dispatchEvent(new Event('online'));
			await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(6));
		} finally {
			stop();
		}
	});
	it('sends a local receipt at once, even for a workspace that is not open', async () => {
		const { client, history, exchange } = setup();
		const stop = client.attach();
		try {
			await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(2));
			history.onPending?.('idle');
			expect(exchange).toHaveBeenLastCalledWith('idle');
		} finally {
			stop();
		}
	});
	it('retries a failed exchange with backoff, but not while the relay storage is full', async () => {
		const { client, exchange } = setup();
		exchange.mockRejectedValueOnce(new Error('temporary outage'));
		exchange.mockRejectedValueOnce(new ReminderStorageFullError());
		const stop = client.attach();
		try {
			await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(2));
			await vi.advanceTimersByTimeAsync(2000);
			// Only the outage came back; the full account waits for the next change.
			expect(exchange).toHaveBeenCalledTimes(3);
			await vi.advanceTimersByTimeAsync(10 * 60_000);
			expect(exchange).toHaveBeenCalledTimes(3);
		} finally {
			stop();
		}
	});
	it('drops the retry of a workspace that was removed', async () => {
		const { client, exchange, setProfiles } = setup();
		exchange.mockRejectedValue(new Error('offline'));
		const stop = client.attach();
		try {
			await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(2));
			setProfiles([]);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(exchange).toHaveBeenCalledTimes(2);
		} finally {
			stop();
		}
	});
});
