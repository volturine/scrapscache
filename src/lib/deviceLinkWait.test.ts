import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const poll = vi.hoisted(() => vi.fn());
vi.mock('#lib/deviceLink.js', () => ({ pollDeviceLink: poll }));

import type { StartedDeviceLink } from './deviceLink';
import { DEVICE_LINK_POLL_MS, waitForDeviceLink } from './deviceLinkWait';

const link: StartedDeviceLink = {
	id: 'link-1',
	expiresAt: 0,
	role: 'new',
	syncCode: 'ABCD1234EFGH5678',
	pake: { ephemeralSecret: 'secret', share: 'share' }
};

describe('waiting for the other device of a link', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		poll.mockReset();
	});

	afterEach(() => vi.useRealTimers());

	it('asks again a moment after each answer, never while one is awaited', async () => {
		let answer: (value: { success: boolean }) => void = () => undefined;
		poll
			.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
			.mockResolvedValueOnce({ success: true })
			.mockResolvedValueOnce({ success: true, linked: true, receivedSyncKey: 'key' });
		const asked = vi.fn();
		const waiting = waitForDeviceLink(link, null, new AbortController().signal, asked);

		await vi.advanceTimersByTimeAsync(10 * DEVICE_LINK_POLL_MS);
		expect(poll).toHaveBeenCalledTimes(1);

		answer({ success: true });
		await vi.advanceTimersByTimeAsync(DEVICE_LINK_POLL_MS);
		expect(poll).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(DEVICE_LINK_POLL_MS);

		expect(await waiting).toMatchObject({ linked: true, receivedSyncKey: 'key' });
		expect(asked).toHaveBeenCalledTimes(3);
	});

	it('answers as soon as the link ran out or failed', async () => {
		poll.mockResolvedValueOnce({ success: true, expired: true });
		expect(await waitForDeviceLink(link, null, new AbortController().signal)).toMatchObject({
			expired: true
		});

		poll.mockResolvedValueOnce({ success: false, error: 'Could not check device rendezvous' });
		expect(await waitForDeviceLink(link, null, new AbortController().signal)).toMatchObject({
			success: false
		});
	});

	it('stops asking and answers nothing once it is called off', async () => {
		poll.mockResolvedValue({ success: true });
		const stop = new AbortController();
		const waiting = waitForDeviceLink(link, null, stop.signal);
		await vi.advanceTimersByTimeAsync(0);

		stop.abort();
		expect(await waiting).toBeNull();
		await vi.advanceTimersByTimeAsync(10 * DEVICE_LINK_POLL_MS);
		expect(poll).toHaveBeenCalledTimes(1);
	});
});
