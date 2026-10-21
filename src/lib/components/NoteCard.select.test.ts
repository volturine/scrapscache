import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { selectionStore } from '#lib/stores/selection.svelte.js';
import NoteCard from './NoteCard.svelte';

function note(partial: Partial<Note> = {}): Note {
	return {
		id: 'n1',
		title: 'Trip',
		body: 'packing list',
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		...partial
	};
}

function card(): HTMLElement {
	return screen.getByRole('button', { name: /^Open Trip/ }).closest('article')!;
}

afterEach(() => {
	selectionStore.clear();
	notesStore.notes = [];
});

describe('picking a card', () => {
	it('has a check that selects the note without opening it', async () => {
		const onOpen = vi.fn();
		render(NoteCard, { props: { note: note(), onOpen } });
		const check = within(card()).getByRole('checkbox', { name: 'Select Trip' });
		expect(check.getAttribute('aria-checked')).toBe('false');

		await fireEvent.click(check);
		expect(check.getAttribute('aria-checked')).toBe('true');
		expect(selectionStore.ids).toEqual(['n1']);
		expect(card().hasAttribute('data-selected')).toBe(true);
		expect(onOpen).not.toHaveBeenCalled();
	});

	it('turns a click on the card into a pick while a selection is open', async () => {
		const onOpen = vi.fn();
		render(NoteCard, { props: { note: note(), onOpen } });
		selectionStore.toggle('other');

		await fireEvent.click(card());
		expect(selectionStore.ids).toEqual(['other', 'n1']);
		expect(onOpen).not.toHaveBeenCalled();

		await fireEvent.click(card());
		expect(selectionStore.ids).toEqual(['other']);
	});

	it('opens the note as before when nothing is selected', async () => {
		const onOpen = vi.fn();
		render(NoteCard, { props: { note: note(), onOpen } });
		await fireEvent.click(card());
		expect(onOpen).toHaveBeenCalledWith('n1');
	});
});
