import { describe, expect, it } from 'vitest';
import { buildForcePushSnapshot } from './syncForcePush';
import { mergeNoteLists, withoutTombstoned } from './noteMerge';
import type { SyncSnapshot } from './stores/sync.svelte';
import type { Note } from './types';

function note(id: string, title: string, at: number): Note {
	return {
		id,
		title,
		body: '',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		reminder: null,
		createdAt: 1,
		updatedAt: at,
		labels: [],
		images: []
	};
}
function snapshot(notes: Note[]): SyncSnapshot {
	return {
		notes,
		labels: [],
		boards: [],
		tombstones: {},
		labelTombstones: {},
		boardTombstones: {}
	};
}

describe('force push workspace', () => {
	it('overrides newer remote fields and removes cloud-only notes on the next device merge', () => {
		const local = snapshot([note('shared', 'Local wins', 10)]);
		const remote = snapshot([
			{
				...note('shared', 'Remote loses', 9000),
				body: 'old body',
				fieldTimes: { title: 10000, body: 11000 }
			},
			note('remote-only', 'Remove me', 9000)
		]);
		const forced = buildForcePushSnapshot(local, remote, 100);
		const received = withoutTombstoned(
			mergeNoteLists(remote.notes, forced.notes),
			forced.tombstones
		);
		expect(received).toHaveLength(1);
		expect(received[0].title).toBe('Local wins');
		expect(received[0].body).toBe('');
		expect(received[0].updatedAt).toBeGreaterThan(11000);
		expect(forced.tombstones['remote-only']).toBeGreaterThan(11000);
		expect(local.notes[0].updatedAt).toBe(10);
	});
	it('restores a locally present note that another device permanently deleted', () => {
		const local = snapshot([note('deleted', 'Restore me', 10)]);
		const remote = { ...snapshot([]), tombstones: { deleted: 200 } };
		const forced = buildForcePushSnapshot(local, remote, 100);
		expect(forced.notes[0].id).not.toBe('deleted');
		expect(withoutTombstoned(forced.notes, remote.tombstones)).toHaveLength(1);
		expect(forced.tombstones.deleted).toBe(200);
	});
	it('publishes an empty workspace as deletions for all cloud notes', () => {
		const forced = buildForcePushSnapshot(
			snapshot([]),
			snapshot([note('cloud', 'Delete', 10)]),
			100
		);
		expect(forced.notes).toEqual([]);
		expect(forced.tombstones).toEqual({ cloud: 100 });
	});
});
