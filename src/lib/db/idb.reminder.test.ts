import { describe, expect, it } from 'vitest';
import { claimFiredReminderKey, getFiredReminderKeys } from './idb';
import { TEST_WORKSPACE } from '../../tests/workspace';

describe('reminder delivery claims', () => {
	it('allows only one concurrent claim for a wake id', async () => {
		const wakeId = 'a'.repeat(43);
		const claims = await Promise.all([
			claimFiredReminderKey(TEST_WORKSPACE, wakeId),
			claimFiredReminderKey(TEST_WORKSPACE, wakeId)
		]);

		expect(claims.sort()).toEqual([false, true]);
		expect(await getFiredReminderKeys(TEST_WORKSPACE)).toEqual([wakeId]);
	});
});
