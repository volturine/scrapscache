import { describe, expect, it, vi, beforeEach } from 'vitest';
import { syncEventEmitter } from './syncEvents';

describe('syncEventEmitter', () => {
	beforeEach(() => {
		syncEventEmitter.clear();
	});

	it('notifies subscribers for the correct account', () => {
		const listenerA = vi.fn();
		const listenerB = vi.fn();

		const unsubA = syncEventEmitter.subscribe('acc-1', listenerA);
		const unsubB = syncEventEmitter.subscribe('acc-2', listenerB);

		syncEventEmitter.notify('acc-1', 42);

		expect(listenerA).toHaveBeenCalledTimes(1);
		expect(listenerA).toHaveBeenCalledWith(42, undefined);
		expect(listenerB).not.toHaveBeenCalled();

		unsubA();
		unsubB();
	});

	it('unsubscribes cleanly', () => {
		const listener = vi.fn();
		const unsub = syncEventEmitter.subscribe('acc-1', listener);
		expect(syncEventEmitter.listenerCount('acc-1')).toBe(1);

		unsub();
		expect(syncEventEmitter.listenerCount('acc-1')).toBe(0);

		syncEventEmitter.notify('acc-1', 43);
		expect(listener).not.toHaveBeenCalled();
	});

	it('forwards senderClientId when provided', () => {
		const listener = vi.fn();
		const unsub = syncEventEmitter.subscribe('acc-1', listener);

		syncEventEmitter.notify('acc-1', 44, 'client-xyz');
		expect(listener).toHaveBeenCalledWith(44, 'client-xyz');

		unsub();
	});
});
