import type { SyncSnapshot } from '$lib/stores/sync.svelte';
import { NOTE_FIELDS, retargetLocalNotes, touchNoteFields } from '$lib/noteMerge';
import { uid } from '$lib/utils';

/** Publish the local dataset over the observed cloud version, including field clocks and deletes. */
export function buildForcePushSnapshot(
	local: SyncSnapshot,
	remote: SyncSnapshot,
	now = Date.now()
): SyncSnapshot {
	let at = now;
	for (const snapshot of [local, remote]) {
		for (const note of snapshot.notes) {
			at = Math.max(
				at,
				note.updatedAt + 1,
				...Object.values(note.fieldTimes ?? {}).map((time) => time + 1)
			);
		}
		for (const record of [...snapshot.labels, ...snapshot.boards])
			at = Math.max(at, record.updatedAt + 1);
		for (const map of [snapshot.tombstones, snapshot.labelTombstones, snapshot.boardTombstones]) {
			for (const time of Object.values(map)) at = Math.max(at, time + 1);
		}
	}
	const labelIds = new Map(
		local.labels.map((label) => [label.id, remote.labelTombstones[label.id] ? uid() : label.id])
	);
	const labels = local.labels.map((label) => ({
		...label,
		id: labelIds.get(label.id)!,
		updatedAt: at
	}));
	// Permanent deletes are irrevocable for an ID. Restore local versions under fresh IDs.
	const notes = retargetLocalNotes(local.notes, [], remote.tombstones, uid).map((note) =>
		touchNoteFields(
			{
				...note,
				labels: note.labels.map((id) => labelIds.get(id) ?? id)
			},
			NOTE_FIELDS,
			at
		)
	);
	const boards = local.boards.map((board) => ({
		...board,
		id: remote.boardTombstones[board.id] ? uid() : board.id,
		updatedAt: at,
		columns: board.columns.map((column) => ({
			...column,
			labelId: column.labelId ? (labelIds.get(column.labelId) ?? column.labelId) : null
		})),
		backlogFilter: {
			...board.backlogFilter,
			labelIds: board.backlogFilter.labelIds.map((id) => labelIds.get(id) ?? id)
		}
	}));
	function deletions(
		localMap: Record<string, number>,
		remoteMap: Record<string, number>,
		current: { id: string }[],
		previous: { id: string }[]
	) {
		const ids = new Set(current.map((record) => record.id));
		const result = { ...localMap, ...remoteMap };
		for (const record of previous) if (!ids.has(record.id)) result[record.id] = at;
		for (const id of ids) delete result[id];
		return result;
	}
	return {
		notes,
		labels,
		boards,
		tombstones: deletions(local.tombstones, remote.tombstones, notes, remote.notes),
		labelTombstones: deletions(
			local.labelTombstones,
			remote.labelTombstones,
			labels,
			remote.labels
		),
		boardTombstones: deletions(local.boardTombstones, remote.boardTombstones, boards, remote.boards)
	};
}
