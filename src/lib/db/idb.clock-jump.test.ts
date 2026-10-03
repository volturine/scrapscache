import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	clearSyncOutbox,
	commitSyncControl,
	getOutboxGeneration,
	getSyncOutboxKeys,
	putNote
} from '#lib/db/idb.js';
import type { Note } from '#lib/types.js';
import { TEST_WORKSPACE } from '../../tests/workspace';

function note(title: string): Note {
	return {
		id: 'clock-note',
		title,
		body: '',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: []
	};
}

/**
 * Issue #84: sync runs acknowledge up to a generation snapshot taken before
 * uploads start (`getOutboxGeneration(TEST_WORKSPACE)`), and generations are a persisted
 * monotonic counter. A marker stamped mid-sync therefore always sorts above
 * the snapshot — even when the system clock jumps backward between the two.
 */
describe('outbox generations under a backward clock jump', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('keeps a marker stamped after the sync snapshot when the clock jumps backward', async () => {
		await clearSyncOutbox(TEST_WORKSPACE, await getSyncOutboxKeys(TEST_WORKSPACE));

		// Sync starts: capture the generation snapshot like the engine does.
		const snapshotGeneration = await getOutboxGeneration(TEST_WORKSPACE);

		// Clock jumps backward before the mid-sync edit lands.
		vi.spyOn(Date, 'now').mockReturnValue(Math.max(0, snapshotGeneration - 1_000_000));
		await putNote(TEST_WORKSPACE, note('edited mid-sync'), ['note:clock-note']);
		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(['note:clock-note']);

		await commitSyncControl(
			TEST_WORKSPACE,
			[['test-cursor', 1]],
			[{ keys: ['note:clock-note'], through: snapshotGeneration }]
		);

		expect(await getSyncOutboxKeys(TEST_WORKSPACE)).toEqual(['note:clock-note']);
	});
});
