import { pollDeviceLink, type StartedDeviceLink } from '#lib/deviceLink.js';
import type { SyncAccount } from '#lib/relayClient.js';
import { wait } from '#lib/syncRetry.js';

/** How long after an answer the relay is asked again how a link is coming along. */
export const DEVICE_LINK_POLL_MS = 1_500;

/**
 * Wait for a device link to finish: the other device answered, or the link ran
 * out or failed. The relay is asked again a moment after each answer, never while
 * one is awaited. `asked` hears every ask. Aborting `signal` stops the waiting and
 * answers null; a request that fails outright rejects.
 */
export async function waitForDeviceLink(
	link: StartedDeviceLink,
	account: SyncAccount | null,
	signal: AbortSignal,
	asked: () => void = () => undefined
): Promise<Awaited<ReturnType<typeof pollDeviceLink>> | null> {
	while (!signal.aborted) {
		asked();
		const result = await pollDeviceLink(link, account);
		if (signal.aborted) return null;
		if (result.linked || result.expired || !result.success) return result;
		await wait(DEVICE_LINK_POLL_MS, signal);
	}
	return null;
}
