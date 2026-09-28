import { describe, expect, it } from 'vitest';
import { noteAddressHistory } from './noteAddressHistory';

const gallery = '/';
const note = '/#w=workspace&note=n1';
const other = '/#w=workspace&note=n2';
const kanban = '/kanban';
const kanbanNote = '/kanban#w=workspace&note=n1';

describe('note address history', () => {
	it('pushes an entry when a note opens on the page', () => {
		expect(
			noteAddressHistory({
				current: gallery,
				next: note,
				closed: gallery,
				open: true,
				covering: null
			})
		).toEqual({ covering: note, push: note, back: false });
	});

	it('puts the page without the note under an address that already names one', () => {
		expect(
			noteAddressHistory({
				current: note,
				next: note,
				closed: gallery,
				open: true,
				covering: null
			})
		).toEqual({ covering: note, replace: gallery, push: note, back: false });
	});

	it('replaces the open entry when the note changes', () => {
		expect(
			noteAddressHistory({
				current: note,
				next: other,
				closed: gallery,
				open: true,
				covering: note
			})
		).toEqual({ covering: other, replace: other, back: false });
	});

	it('pops the open entry when the note closes', () => {
		expect(
			noteAddressHistory({
				current: note,
				next: gallery,
				closed: gallery,
				open: false,
				covering: note
			})
		).toEqual({ covering: null, back: true });
	});

	it('does not pop after the view has already moved on', () => {
		expect(
			noteAddressHistory({
				current: kanban,
				next: kanban,
				closed: kanban,
				open: false,
				covering: note
			})
		).toEqual({ covering: null, back: false });
	});

	it('keeps the view path when a note opens there', () => {
		expect(
			noteAddressHistory({
				current: kanban,
				next: kanbanNote,
				closed: kanban,
				open: true,
				covering: null
			})
		).toEqual({ covering: kanbanNote, push: kanbanNote, back: false });
	});

	it('clears a note from the address when nothing was pushed', () => {
		expect(
			noteAddressHistory({
				current: note,
				next: gallery,
				closed: gallery,
				open: false,
				covering: null
			})
		).toEqual({ covering: null, replace: gallery, back: false });
	});

	it('leaves a matching closed address alone', () => {
		expect(
			noteAddressHistory({
				current: gallery,
				next: gallery,
				closed: gallery,
				open: false,
				covering: null
			})
		).toEqual({ covering: null, back: false });
	});
});
