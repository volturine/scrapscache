import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dispatch = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/wakeDispatch', () => ({ dispatchDueWakes: dispatch }));

import { armWakeTimer, rescheduleWakeTimer, resetWakeTimer, startWakeTimer } from './wakeTimer';

function delivered(next: number | null) {
	return { sent: 1, failed: 0, gone: 0, next };
}

beforeEach(() => {
	vi.useFakeTimers({ now: 0 });
	dispatch.mockReset().mockResolvedValue(delivered(null));
});

afterEach(() => {
	resetWakeTimer();
	vi.useRealTimers();
});

describe('self-hosted wake timer', () => {
	it('delivers at the wake time', async () => {
		await armWakeTimer('account', 90_000);
		await vi.advanceTimersByTimeAsync(89_999);
		expect(dispatch).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(dispatch).toHaveBeenCalledOnce();
	});

	it('keeps the earliest wake and follows on to the next one by itself', async () => {
		dispatch.mockResolvedValueOnce(delivered(200_000));
		await armWakeTimer('a', 120_000);
		await armWakeTimer('b', 60_000);
		await armWakeTimer('c', 180_000);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(dispatch).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(140_000);
		expect(dispatch).toHaveBeenCalledTimes(2);
	});

	it('picks up wakes stored before the server started', async () => {
		await startWakeTimer();
		await vi.advanceTimersByTimeAsync(0);
		expect(dispatch).toHaveBeenCalledOnce();
	});

	it('runs again after a delivery that was asked for while one was under way', async () => {
		let finish!: (value: unknown) => void;
		dispatch.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
		await armWakeTimer('a', 0);
		await vi.advanceTimersByTimeAsync(0);
		await rescheduleWakeTimer('b', 0);
		finish(delivered(null));
		await vi.advanceTimersByTimeAsync(0);
		expect(dispatch).toHaveBeenCalledTimes(2);
	});

	it('tries again shortly when the store fails', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		dispatch.mockRejectedValueOnce(new Error('database down'));
		await armWakeTimer('a', 0);
		await vi.advanceTimersByTimeAsync(0);
		expect(dispatch).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(dispatch).toHaveBeenCalledTimes(2);
		error.mockRestore();
	});
});
