import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '$lib/types';
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

function shield(): HTMLElement {
	const found = document.querySelector('[data-card-shield]');
	if (!found) throw new Error('card has no shield');
	return found as HTMLElement;
}

async function pointer(target: Element, type: string, x: number, y: number) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.assign(event, { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y });
	await fireEvent(target, event);
}

afterEach(() => {
	notesStore.notes = [];
	notesStore.labels = [];
});

describe('KanbanCard content shield', () => {
	it('starts a touch drag from a press over a link preview', async () => {
		const { container } = render(KanbanCard, {
			props: {
				note: note(),
				sourceColumnId: 'todo',
				onOpen: vi.fn(),
				onMove: vi.fn()
			}
		});
		const card = container.querySelector('.kanban-card') as HTMLElement;

		await pointer(shield(), 'pointerdown', 100, 100);
		await pointer(shield(), 'pointermove', 140, 160);

		expect(card.style.left).toBe('40px');
		expect(card.style.top).toBe('60px');
	});

	it('opens the note when a press over the preview does not turn into a drag', async () => {
		const onOpen = vi.fn();
		render(KanbanCard, {
			props: { note: note(), sourceColumnId: 'todo', onOpen, onMove: vi.fn() }
		});

		await pointer(shield(), 'pointerdown', 100, 100);
		await pointer(shield(), 'pointerup', 100, 100);
		await fireEvent.click(shield());

		expect(onOpen).toHaveBeenCalledWith('note-1');
	});
});
