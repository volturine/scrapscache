import { moveNoteLabels, type KanbanColumn } from '#lib/kanban.js';
import { actionUndo } from '#lib/stores/actionUndo.svelte.js';
import { kanbanStore } from '#lib/stores/kanban.svelte.js';
import { notesStore } from '#lib/stores/notes.svelte.js';

/**
 * Move a card to another column of a board: the note trades the source column's
 * label for the destination's and lands in `order`. Nothing else on screen says the
 * label changed, so the move offers Undo like archiving does.
 */
export function moveCardToColumn(move: {
	boardId: string;
	noteId: string;
	source: KanbanColumn;
	destination: KanbanColumn;
	/** The destination column's order with the card in its new slot. */
	order: string[];
	/** Shown on the undo bar, e.g. "Moved to Doing". */
	message: string;
}): void {
	const { boardId, noteId, source, destination, order, message } = move;
	const note = notesStore.notes.find((candidate) => candidate.id === noteId);
	if (!note) {
		kanbanStore.placeCard(boardId, noteId, source.id, destination.id, order);
		return;
	}
	// Copied now: the columns are reactive proxies that change as the board does.
	const sourceId = source.id;
	const destinationId = destination.id;
	const sourceOrder = [...source.order];
	const landedOrder = [...order];
	const before = { labels: [...note.labels] };
	const after = { labels: moveNoteLabels(note.labels, source.labelId, destination.labelId) };
	const apply = () => {
		notesStore.updateNote(noteId, after);
		kanbanStore.placeCard(boardId, noteId, sourceId, destinationId, landedOrder);
	};
	apply();
	actionUndo.push({
		message,
		noteIds: [noteId],
		undo: () => {
			notesStore.updateNote(noteId, before);
			kanbanStore.placeCard(boardId, noteId, destinationId, sourceId, sourceOrder);
		},
		redo: apply
	});
}
