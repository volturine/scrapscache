import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '$lib/types';
import { kanbanDrag } from '$lib/kanbanDrag.svelte';
import { notesStore } from '$lib/stores/notes.svelte';
import KanbanCard from './KanbanCard.svelte';

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'Ship it',
		body: 'https://webassembly.org/',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		images: [],
		...partial
	};
}

function card(props: Partial<Record<string, unknown>> = {}) {
	return render(KanbanCard, {
		props: {
			note: note(),
			columnId: 'todo',
			index: 0,
			onOpen: vi.fn(),
			onDrop: vi.fn(),
			...props
		}
	});
}

function shield(): HTMLElement {
	const found = document.querySelector('[data-card-shield]');
	if (!found) throw new Error('card has no shield');
	return found as HTMLElement;
}

async function pointer(target: Element | Window, type: string, x: number, y: number) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.assign(event, {
		pointerType: 'touch',
		pointerId: 1,
		isPrimary: true,
		button: 0,
		clientX: x,
		clientY: y
	});
	await fireEvent(target as Element, event);
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	// cancel() also clears the post-drop click guard, so the next test's tap lands.
	kanbanDrag.cancel();
	vi.useRealTimers();
	notesStore.notes = [];
	notesStore.labels = [];
});

describe('KanbanCard content shield', () => {
	it('picks the card up from a press-and-hold over a link preview', async () => {
		card();

		await pointer(shield(), 'pointerdown', 100, 100);
		vi.advanceTimersByTime(300);
		await pointer(window, 'pointermove', 140, 160);

		expect(kanbanDrag.active).toBe(true);
		expect(kanbanDrag.noteId).toBe('note-1');
	});

	it('leaves a swipe down the page to the browser instead of dragging', async () => {
		card();

		await pointer(shield(), 'pointerdown', 100, 100);
		await pointer(window, 'pointermove', 100, 160);
		vi.advanceTimersByTime(300);

		expect(kanbanDrag.active).toBe(false);
	});

	it('pans the board from a sideways swipe, and does not open the note after it', async () => {
		const onOpen = vi.fn();
		const { container } = card({ onOpen });
		// A board wide enough to scroll, wrapped around the rendered card.
		const board = document.createElement('div');
		board.dataset.kanbanColumn = 'todo';
		board.style.overflowX = 'scroll';
		Object.defineProperties(board, {
			scrollWidth: { value: 900 },
			clientWidth: { value: 390 }
		});
		document.body.appendChild(board);
		board.appendChild(container);
		board.scrollLeft = 300;

		await pointer(shield(), 'pointerdown', 200, 100);
		await pointer(window, 'pointermove', 160, 104);
		await pointer(window, 'pointermove', 120, 104);
		await pointer(window, 'pointerup', 120, 104);
		await fireEvent.click(shield());

		expect(board.scrollLeft).toBe(380);
		expect(kanbanDrag.active).toBe(false);
		expect(onOpen).not.toHaveBeenCalled();
	});

	it('drops the card where the pointer released it', async () => {
		const onDrop = vi.fn();
		card({ onDrop });

		await pointer(shield(), 'pointerdown', 100, 100);
		vi.advanceTimersByTime(300);
		await pointer(window, 'pointermove', 140, 160);
		await pointer(window, 'pointerup', 140, 160);

		expect(onDrop).toHaveBeenCalledWith('note-1', 'todo', { columnId: 'todo', index: 0 });
		expect(kanbanDrag.active).toBe(false);
	});

	it('opens the note when a press over the preview does not turn into a drag', async () => {
		const onOpen = vi.fn();
		card({ onOpen });

		await pointer(shield(), 'pointerdown', 100, 100);
		await pointer(window, 'pointerup', 100, 100);
		await fireEvent.click(shield());

		expect(onOpen).toHaveBeenCalledWith('note-1');
	});

	it('does not open the note on the click that ends a drag', async () => {
		const onOpen = vi.fn();
		card({ onOpen });

		await pointer(shield(), 'pointerdown', 100, 100);
		vi.advanceTimersByTime(300);
		await pointer(window, 'pointermove', 140, 160);
		await pointer(window, 'pointerup', 140, 160);
		await fireEvent.click(shield());

		expect(onOpen).not.toHaveBeenCalled();
	});
});
