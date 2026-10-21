import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '#lib/types.js';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { selectionStore } from '#lib/stores/selection.svelte.js';
import NoteCard from './NoteCard.svelte';
import { noteSelectStyles } from '$panda/styles';

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

	it('puts the check on the reminder strip while a selection is open, not over the title', async () => {
		render(NoteCard, {
			props: { note: note({ reminder: Date.now() + 3_600_000 }), onOpen: vi.fn() }
		});
		selectionStore.toggle('other');
		await tick();
		const strip = card().querySelector('[aria-label^="Reminder, "]')!;
		expect(strip.classList.contains(noteSelectStyles.stripRoom)).toBe(true);
		// The strip holds the check, so the title keeps its place.
		expect(within(card()).getByText('Trip').classList.contains(noteSelectStyles.titleRoom)).toBe(
			false
		);
	});

	it('makes room on the title when the card has no reminder strip', async () => {
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });
		expect(within(card()).getByText('Trip').classList.contains(noteSelectStyles.titleRoom)).toBe(
			false
		);
		selectionStore.toggle('other');
		await tick();
		expect(within(card()).getByText('Trip').classList.contains(noteSelectStyles.titleRoom)).toBe(
			true
		);
	});

	it('opens the note as before when nothing is selected', async () => {
		const onOpen = vi.fn();
		render(NoteCard, { props: { note: note(), onOpen } });
		await fireEvent.click(card());
		expect(onOpen).toHaveBeenCalledWith('n1');
	});
});
