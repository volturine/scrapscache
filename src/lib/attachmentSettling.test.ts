import { afterEach, describe, expect, it, vi } from 'vitest';
import { settleAttachments } from './attachmentSettling';
import { attachmentWritesLock } from '#lib/db/idb.js';
import { createSyncIdentity } from '#lib/syncPairing.js';
import { TEST_WORKSPACE } from '../tests/workspace';

describe('settling attachments', () => {
	afterEach(() => vi.unstubAllGlobals());

	// Reading what the device holds waits for every write of bytes that has begun. A
	// write that keeps failing, in any window, holds that wait up for as long as it is
	// retried, and the sync waiting there holds the sync lock.
	it('gives up waiting for bytes still being written when its sync is given up', async () => {
		const round = new AbortController();
		const asked: Array<{ name: string; signal?: AbortSignal }> = [];
		vi.stubGlobal('navigator', {
			...navigator,
			locks: {
				request: (name: string, options: { signal?: AbortSignal }) => {
					asked.push({ name, signal: options.signal });
					// Never granted: only giving the request up ends it.
					return new Promise((_resolve, reject) =>
						options.signal?.addEventListener('abort', () =>
							reject(new DOMException('The request was aborted', 'AbortError'))
						)
					);
				}
			}
		});

		const settling = settleAttachments({
			notes: [],
			pid: TEST_WORKSPACE,
			account: createSyncIdentity(),
			relay: {
				relayHolds: () => true,
				relayHas: () => undefined,
				owes: async () => undefined
			},
			signal: round.signal,
			unreadable: () => undefined
		});
		await Promise.resolve();
		expect(asked).toEqual([{ name: attachmentWritesLock(TEST_WORKSPACE), signal: round.signal }]);

		round.abort();
		await expect(settling).rejects.toMatchObject({ name: 'AbortError' });
	});
});
