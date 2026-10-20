import { kanbanStore } from '#lib/stores/kanban.svelte.js';
import { notesStore } from '#lib/stores/notes.svelte.js';

/** Sets of columns a new board can start from, so the first run is not a dead end. */
export const BOARD_TEMPLATES: readonly { id: string; names: readonly string[] }[] = [
	{ id: 'progress', names: ['To-Do', 'In-Progress', 'Done'] },
	{ id: 'writing', names: ['Ideas', 'Draft', 'Published'] }
];

/** Find a label by name, however it is cased, or create it. */
export function labelNamed(name: string) {
	const wanted = name.trim().toLowerCase();
	return (
		notesStore.labels.find((label) => label.name.toLowerCase() === wanted) ??
		notesStore.createLabel(name)
	);
}

/**
 * Give a board one label column per name, in that order. Labels that exist are
 * reused, the rest are created, and a column the board already has is left alone.
 */
export function applyBoardTemplate(boardId: string, names: readonly string[]): void {
	for (const name of names) {
		const label = labelNamed(name);
		if (!label) continue;
		const board = kanbanStore.boards.find((candidate) => candidate.id === boardId);
		if (!board || board.columns.some((column) => column.labelId === label.id)) continue;
		kanbanStore.addTagColumn(boardId, label.id);
	}
}
