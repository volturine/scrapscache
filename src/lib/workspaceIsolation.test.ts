/**
 * Every workspace keeps its own notes, labels, boards and delete manifests, and
 * a read only ever sees what the same workspace wrote.
 *
 * These held once and then quietly stopped: a helper that worked out which
 * workspace was meant from how many arguments turned up sent a signed-in
 * workspace's boards to one place and read them back from another, so it lost
 * its board on every load. The rule is cheap to check and expensive to lose,
 * so it is checked here for each store rather than trusted to each caller.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	deleteLabel,
	deleteNote,
	getAllLabels,
	getAllNotesMetadata,
	hydrateNoteAttachments,
	isNamespaceRedundant,
	LOCAL_PROFILE_ID,
	putLabel,
	putNote
} from '$lib/db/idb';
import {
	hydrateTombstones,
	loadBoardsFromDevice,
	saveBoardsToDevice,
	writeLabelTombstones,
	writeTombstones,
	writeKanbanState
} from '$lib/syncTombstones';
import {
	clearNotesMirror,
	readLabelsMirror,
	readNotesMirror,
	writeLabelsMirror,
	writeNotesMirror
} from '$lib/noteStorage';
import { createKanbanBoard } from '$lib/kanban';
import type { Label, Note } from '$lib/types';

const MINE = 'workspace-mine';
const THEIRS = 'workspace-theirs';

function note(id: string): Note {
	return {
		id,
		title: id,
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

function label(id: string): Label {
	return { id, name: id, createdAt: 1, updatedAt: 1 };
}

beforeEach(() => {
	localStorage.clear();
});

describe('notes stay in the workspace that saved them', () => {
	it('keeps each workspace to its own notes', async () => {
		await putNote(MINE, note('mine-1'));
		await putNote(THEIRS, note('theirs-1'));
		await putNote(LOCAL_PROFILE_ID, note('anonymous-1'));

		expect((await getAllNotesMetadata(MINE)).map((n) => n.id)).toEqual(['mine-1']);
		expect((await getAllNotesMetadata(THEIRS)).map((n) => n.id)).toEqual(['theirs-1']);
		expect((await getAllNotesMetadata(LOCAL_PROFILE_ID)).map((n) => n.id)).toEqual(['anonymous-1']);
	});

	it('deletes from the workspace it was told, and no other', async () => {
		await putNote(MINE, note('shared-id'));
		await putNote(THEIRS, note('shared-id'));

		await deleteNote(MINE, 'shared-id');

		expect(await getAllNotesMetadata(MINE)).toEqual([]);
		expect((await getAllNotesMetadata(THEIRS)).map((n) => n.id)).toEqual(['shared-id']);
	});
});

describe('labels stay in the workspace that saved them', () => {
	it('keeps each workspace to its own labels', async () => {
		await putLabel(MINE, label('mine-tag'));
		await putLabel(THEIRS, label('theirs-tag'));

		expect((await getAllLabels(MINE)).map((l) => l.id)).toEqual(['mine-tag']);
		expect((await getAllLabels(THEIRS)).map((l) => l.id)).toEqual(['theirs-tag']);
	});

	it('deletes from the workspace it was told, and no other', async () => {
		await putLabel(MINE, label('shared-tag'));
		await putLabel(THEIRS, label('shared-tag'));

		await deleteLabel(MINE, 'shared-tag');

		expect(await getAllLabels(MINE)).toEqual([]);
		expect((await getAllLabels(THEIRS)).map((l) => l.id)).toEqual(['shared-tag']);
	});
});

describe('boards stay in the workspace that saved them', () => {
	it('reads back its own boards, whatever the fallback is', async () => {
		await saveBoardsToDevice(LOCAL_PROFILE_ID, [
			{ ...createKanbanBoard('Anonymous'), id: 'anon-board' }
		]);
		await saveBoardsToDevice(MINE, [{ ...createKanbanBoard('Mine'), id: 'my-board' }]);

		// An undefined fallback is how the store asks "have I saved any?", and
		// must not read as "no workspace given".
		const mine = await loadBoardsFromDevice<{ id: string }[] | undefined>(MINE, undefined);
		const theirs = await loadBoardsFromDevice<{ id: string }[] | undefined>(THEIRS, undefined);

		expect(mine?.map((board) => board.id)).toEqual(['my-board']);
		expect(theirs).toBeUndefined();
	});

	it('keeps board delete manifests apart', async () => {
		await writeKanbanState(MINE, [], { 'board-x': 10 }, []);
		await writeKanbanState(THEIRS, [], { 'board-y': 20 }, []);

		expect((await hydrateTombstones(MINE)).boards).toEqual({ 'board-x': 10 });
		expect((await hydrateTombstones(THEIRS)).boards).toEqual({ 'board-y': 20 });
	});
});

describe('delete manifests stay in the workspace that wrote them', () => {
	it('keeps note tombstones apart', async () => {
		await writeTombstones(MINE, { 'note-x': 10 });
		await writeTombstones(THEIRS, { 'note-y': 20 });

		expect((await hydrateTombstones(MINE)).notes).toEqual({ 'note-x': 10 });
		expect((await hydrateTombstones(THEIRS)).notes).toEqual({ 'note-y': 20 });
	});

	it('keeps label tombstones apart', async () => {
		await writeLabelTombstones(MINE, { 'tag-x': 10 }, []);
		await writeLabelTombstones(THEIRS, { 'tag-y': 20 }, []);

		expect((await hydrateTombstones(MINE)).labels).toEqual({ 'tag-x': 10 });
		expect((await hydrateTombstones(THEIRS)).labels).toEqual({ 'tag-y': 20 });
	});
});

describe('fast-boot mirrors stay in the workspace that wrote them', () => {
	it('keeps each workspace to its own mirrored notes and labels', () => {
		writeNotesMirror([note('mine-1')], MINE);
		writeNotesMirror([note('theirs-1')], THEIRS);
		writeLabelsMirror([label('mine-tag')], MINE);
		writeLabelsMirror([label('theirs-tag')], THEIRS);

		expect(readNotesMirror(MINE).map((n) => n.id)).toEqual(['mine-1']);
		expect(readNotesMirror(THEIRS).map((n) => n.id)).toEqual(['theirs-1']);
		expect(readLabelsMirror(MINE).map((l) => l.id)).toEqual(['mine-tag']);
		expect(readLabelsMirror(THEIRS).map((l) => l.id)).toEqual(['theirs-tag']);
	});

	it('clears only the workspace it was told to clear', () => {
		writeNotesMirror([note('mine-1')], MINE);
		writeNotesMirror([note('theirs-1')], THEIRS);

		clearNotesMirror(MINE);

		expect(readNotesMirror(MINE)).toEqual([]);
		expect(readNotesMirror(THEIRS).map((n) => n.id)).toEqual(['theirs-1']);
	});

	it('gives each workspace its own mirrored Kanban boards', async () => {
		const { KanbanStore } = await import('$lib/stores/kanban.svelte');
		const { syncStore } = await import('$lib/stores/sync.svelte');
		const activePid = vi.spyOn(syncStore, 'activePid', 'get');

		activePid.mockReturnValue(MINE);
		const mine = new KanbanStore();
		mine.renameBoard(mine.boards[0].id, 'Mine');

		activePid.mockReturnValue(THEIRS);
		const theirs = new KanbanStore();
		theirs.renameBoard(theirs.boards[0].id, 'Theirs');

		activePid.mockReturnValue(MINE);
		expect(new KanbanStore().boards.map((board) => board.name)).toEqual(['Mine']);
		activePid.mockReturnValue(THEIRS);
		expect(new KanbanStore().boards.map((board) => board.name)).toEqual(['Theirs']);
		activePid.mockRestore();
	});
});

describe('a workspace is only redundant when nothing in it is unique', () => {
	// The anonymous workspace's notes are copied into a signed-in one when it is
	// created; once they are all over there, the local copy is dropped to save
	// room. Anything the copy still holds alone has to stop that.
	async function anonymousAdoptedBy(pid: string) {
		await putNote(LOCAL_PROFILE_ID, note('shared'));
		await putNote(pid, note('shared'));
	}

	it('drops a copy whose notes and boards both live in the workspace', async () => {
		await anonymousAdoptedBy(MINE);
		const board = { ...createKanbanBoard('Plans'), id: 'board-1', updatedAt: 5 };
		await saveBoardsToDevice(LOCAL_PROFILE_ID, [board]);
		await saveBoardsToDevice(MINE, [board]);

		expect(await isNamespaceRedundant(LOCAL_PROFILE_ID, MINE)).toBe(true);
	});

	it('keeps a copy holding the only version of a board', async () => {
		await anonymousAdoptedBy(MINE);
		await saveBoardsToDevice(LOCAL_PROFILE_ID, [
			{ ...createKanbanBoard('Plans'), id: 'board-1', updatedAt: 5 }
		]);
		await saveBoardsToDevice(MINE, []);

		expect(await isNamespaceRedundant(LOCAL_PROFILE_ID, MINE)).toBe(false);
	});

	it('keeps a copy whose board was arranged more recently', async () => {
		await anonymousAdoptedBy(MINE);
		await saveBoardsToDevice(LOCAL_PROFILE_ID, [
			{ ...createKanbanBoard('Plans'), id: 'board-1', updatedAt: 9 }
		]);
		await saveBoardsToDevice(MINE, [
			{ ...createKanbanBoard('Plans'), id: 'board-1', updatedAt: 5 }
		]);

		expect(await isNamespaceRedundant(LOCAL_PROFILE_ID, MINE)).toBe(false);
	});
});

describe('switching workspaces leaves each one as it was', () => {
	it('does not carry the boards of the workspace being left', async () => {
		const { KanbanStore } = await import('$lib/stores/kanban.svelte');
		const { syncStore } = await import('$lib/stores/sync.svelte');
		const activePid = vi.spyOn(syncStore, 'activePid', 'get');

		// The anonymous workspace has a board of its own on this device.
		await saveBoardsToDevice(LOCAL_PROFILE_ID, [
			{ ...createKanbanBoard('Anonymous plans'), id: 'anon-board', updatedAt: 1 }
		]);

		// A signed-in workspace is used, and its board edited more recently.
		activePid.mockReturnValue(MINE);
		const store = new KanbanStore();
		await store.hydrateFromDevice(MINE);
		store.renameBoard(store.boards[0].id, 'Synced plans');

		// Switching back must show the anonymous workspace's own board.
		activePid.mockReturnValue(LOCAL_PROFILE_ID);
		await store.hydrateFromDevice(LOCAL_PROFILE_ID);

		expect(store.boards.map((board) => board.name)).toEqual(['Anonymous plans']);
		activePid.mockRestore();
	});

	it('does not carry board deletions into the workspace being entered', async () => {
		const { KanbanStore } = await import('$lib/stores/kanban.svelte');
		const { syncStore } = await import('$lib/stores/sync.svelte');
		const activePid = vi.spyOn(syncStore, 'activePid', 'get');

		await saveBoardsToDevice(LOCAL_PROFILE_ID, [
			{ ...createKanbanBoard('Anonymous plans'), id: 'shared-board-id', updatedAt: 1 }
		]);

		activePid.mockReturnValue(MINE);
		const store = new KanbanStore();
		await store.hydrateFromDevice(MINE);
		// Delete the synced workspace's board, which shares an id with the
		// anonymous one because it was copied from it.
		store.boards = [{ ...createKanbanBoard('Synced'), id: 'shared-board-id', updatedAt: 2 }];
		store.deleteBoard('shared-board-id');

		activePid.mockReturnValue(LOCAL_PROFILE_ID);
		await store.hydrateFromDevice(LOCAL_PROFILE_ID);

		expect(store.boards.map((board) => board.name)).toEqual(['Anonymous plans']);
		activePid.mockRestore();
	});
});

describe('attachment bytes stay in the workspace that saved them', () => {
	// A one pixel PNG, as a photo pasted into a note arrives.
	const bytes =
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

	function withPhoto(id: string): Note {
		return {
			...note(id),
			images: [{ id: `${id}-photo`, mime: 'image/png', dataUrl: bytes, createdAt: 1 }]
		};
	}

	it('gives each workspace back only its own bytes', async () => {
		await putNote(MINE, withPhoto('mine-1'));
		await putNote(THEIRS, note('theirs-1'));

		const [mine] = await getAllNotesMetadata(MINE);
		const [theirs] = await getAllNotesMetadata(THEIRS);
		const mineFull = await hydrateNoteAttachments(MINE, mine);
		const theirsFull = await hydrateNoteAttachments(THEIRS, theirs);

		expect(mineFull.images?.[0]?.dataUrl).toBe(bytes);
		expect(theirsFull.images ?? []).toEqual([]);
	});

	it('does not hand one workspace\u2019s bytes to another asking for the same note', async () => {
		await putNote(MINE, withPhoto('shared-id'));
		// The other workspace knows the note by id but never stored its bytes.
		await putNote(THEIRS, { ...note('shared-id'), images: [] });

		const [theirs] = await getAllNotesMetadata(THEIRS);
		const hydrated = await hydrateNoteAttachments(THEIRS, theirs);

		expect(hydrated.images ?? []).toEqual([]);
	});
});
