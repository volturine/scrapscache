import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '$lib/types';
import { notesStore } from '$lib/stores/notes.svelte';
import NoteCard from './NoteCard.svelte';

const PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'note-1',
		title: 'Trip',
		// The body carries a link, so the card renders a link preview over it.
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
		images: [{ id: 'photo-1', mime: 'image/png', dataUrl: PNG, name: 'map.png', createdAt: 1 }],
		...partial
	};
}

/** The element a finger lands on anywhere over a card's content. */
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

describe('NoteCard content shield', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		notesStore.notes = [note()];
		notesStore.labels = [];
	});

	afterEach(() => {
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
		notesStore.notes = [];
	});

	it('covers links and photos so a press over them still swipes the card', async () => {
		const archive = vi.spyOn(notesStore, 'toggleArchive').mockImplementation(() => {});
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });
		// The link preview and photo are behind the shield, never pressed directly.
		expect(screen.getByText('webassembly.org')).toBeTruthy();

		const surface = shield();
		await pointer(surface, 'pointerdown', 300, 100);
		await pointer(surface, 'pointermove', 200, 104);
		await pointer(surface, 'pointerup', 200, 104);
		vi.advanceTimersByTime(200);

		expect(archive).toHaveBeenCalledWith('note-1');
	});

	it('opens the note when the click lands on the shield rather than dragging', async () => {
		const onOpen = vi.fn();
		render(NoteCard, { props: { note: note(), onOpen } });

		await fireEvent.click(shield());

		expect(onOpen).toHaveBeenCalledWith('note-1');
	});

	it('leaves nothing inside the preview to click, focus or drag', () => {
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });

		const content = document.querySelector('[data-card-shield]')
			?.previousElementSibling as HTMLElement;
		expect(content.querySelector('button')).toBeNull();
		expect(content.querySelector('a')).toBeNull();
		// The card body still reads as text for assistive technology.
		expect(content.textContent).toContain('webassembly.org');
	});
});
