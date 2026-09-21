import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '$lib/types';
import { notesStore } from '$lib/stores/notes.svelte';
import NoteCard from './NoteCard.svelte';

function note(): Note {
	return {
		id: 'note-1',
		title: 'Wide table',
		body: [
			'| one | two | three | four | five |',
			'| --- | --- | --- | --- | --- |',
			'| a | b | c | d | e |'
		].join('\n'),
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		images: []
	};
}

function pointer(type: string, x: number, y: number) {
	return new PointerEvent(type, {
		bubbles: true,
		cancelable: true,
		pointerId: 1,
		pointerType: 'touch',
		clientX: x,
		clientY: y
	});
}

describe('NoteCard gallery table scroll', () => {
	beforeEach(() => {
		notesStore.notes = [note()];
		notesStore.labels = [];
	});

	afterEach(() => {
		notesStore.notes = [];
		vi.restoreAllMocks();
	});

	it('scrolls a wide table sideways and does not open the note', () => {
		const onOpen = vi.fn();
		render(NoteCard, { props: { note: note(), onOpen } });
		const scroll = document.querySelector('[data-markdown-table-container]') as HTMLElement;
		Object.defineProperty(scroll, 'scrollWidth', { configurable: true, get: () => 400 });
		Object.defineProperty(scroll, 'clientWidth', { configurable: true, get: () => 120 });
		document.elementsFromPoint = () => [scroll];

		const card = screen.getByRole('button', { name: 'Open Wide table' });
		card.dispatchEvent(pointer('pointerdown', 80, 40));
		card.dispatchEvent(pointer('pointermove', 40, 42));
		card.dispatchEvent(pointer('pointerup', 40, 42));
		fireEvent.click(card);

		expect(scroll.scrollLeft).toBe(40);
		expect(onOpen).not.toHaveBeenCalled();
	});

	it('scrolls the table with a horizontal wheel', () => {
		render(NoteCard, { props: { note: note(), onOpen: vi.fn() } });
		const scroll = document.querySelector('[data-markdown-table-container]') as HTMLElement;
		Object.defineProperty(scroll, 'scrollWidth', { configurable: true, get: () => 400 });
		Object.defineProperty(scroll, 'clientWidth', { configurable: true, get: () => 120 });
		document.elementsFromPoint = () => [scroll];

		const card = screen.getByRole('button', { name: 'Open Wide table' });
		const wheel = new WheelEvent('wheel', {
			bubbles: true,
			cancelable: true,
			deltaX: 30,
			deltaY: 0,
			clientX: 80,
			clientY: 40
		});
		card.dispatchEvent(wheel);

		expect(scroll.scrollLeft).toBe(30);
		expect(wheel.defaultPrevented).toBe(true);
	});
});
