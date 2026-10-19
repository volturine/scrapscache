import { boardColumnLabelIds, moveNoteLabels, type KanbanColumn } from '#lib/kanban.js';
import { actionUndo } from '#lib/stores/actionUndo.svelte.js';
import { kanbanStore } from '#lib/stores/kanban.svelte.js';
import { notesStore } from '#lib/stores/notes.svelte.js';

/** Where a card sat in a column's order: its index and the card after it. */
type Slot = { index: number; before: string | null };

function slotOf(order: readonly string[], noteId: string): Slot | null {
	const index = order.indexOf(noteId);
	return index === -1 ? null : { index, before: order[index + 1] ?? null };
}

/**
 * Put a card back into a column's current order: before the card that followed
 * it, else at its old index. A card that had no place in the order gets none.
 */
function placeIn(order: readonly string[], noteId: string, slot: Slot | null): string[] {
	const rest = order.filter((id) => id !== noteId);
	if (!slot) return rest;
	const next = slot.before === null ? -1 : rest.indexOf(slot.before);
	const at =
		slot.before === null ? rest.length : next === -1 ? Math.min(slot.index, rest.length) : next;
	return [...rest.slice(0, at), noteId, ...rest.slice(at)];
}

/**
 * Move a card to another column of a board: the note trades the source column's
 * label for the destination's and lands in `order`. Nothing else on screen says the
 * label changed, so the move offers Undo like archiving does.
 *
 * Undo and redo work on the note and board as they are by then: they trade only the
 * labels the move traded and move only this card, so later edits, reorders and synced
 * changes stay. A move that something else has since overtaken is left alone.
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
	const labels = moveNoteLabels(note.labels, source.labelId, destination.labelId);
	const removed = note.labels.filter((id) => !labels.includes(id));
	const added = labels.filter((id) => !note.labels.includes(id));
	// Read now: the columns are reactive proxies that change as the board does.
	const sourceId = source.id;
	const destinationId = destination.id;
	const sourceSlot = slotOf(source.order, noteId);
	const destinationSlot = slotOf(order, noteId);

	notesStore.updateNote(noteId, { labels });
	kanbanStore.placeCard(boardId, noteId, sourceId, destinationId, [...order]);

	/** Take `take` labels off and put `give` back, moving the card from `leave` to `enter`. */
	function trade(take: string[], give: string[], leave: string, enter: string, slot: Slot | null) {
		const current = notesStore.notes.find((candidate) => candidate.id === noteId);
		if (!current || current.trashed || current.archived) return;
		// Only while the card still carries what the last step left it with.
		if (!take.every((id) => current.labels.includes(id))) return;
		if (give.some((id) => current.labels.includes(id))) return;
		if (!give.every((id) => notesStore.labelsById.has(id))) return;
		const board = kanbanStore.boards.find((candidate) => candidate.id === boardId);
		const from = board?.columns.find((candidate) => candidate.id === leave);
		const column = board?.columns.find((candidate) => candidate.id === enter);
		if (!board || !from || !column) return;
		// ...and still sits in the column it leaves: with that column's label, or in
		// the Backlog with none of the board's column labels.
		const inLeave =
			from.labelId === null
				? !current.labels.some((id) => boardColumnLabelIds(board).has(id))
				: current.labels.includes(from.labelId);
		if (!inLeave) return;
		notesStore.updateNote(noteId, {
			labels: [...current.labels.filter((id) => !take.includes(id)), ...give]
		});
		kanbanStore.placeCard(boardId, noteId, leave, enter, placeIn(column.order, noteId, slot));
	}

	actionUndo.push({
		message,
		noteIds: [noteId],
		undo: () => trade(added, removed, destinationId, sourceId, sourceSlot),
		redo: () => trade(removed, added, sourceId, destinationId, destinationSlot)
	});
}
