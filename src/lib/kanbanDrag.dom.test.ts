import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kanbanDrag } from './kanbanDrag.svelte';

/** jsdom has no layout, so each card is told where it sits. */
function card(id: string, top: number, height: number, carried = false): HTMLElement {
	const el = document.createElement('div');
	el.dataset.kanbanCard = id;
	if (carried) el.dataset.kanbanCarried = '';
	Object.defineProperties(el, {
		offsetTop: { value: top },
		offsetHeight: { value: height }
	});
	return el;
}

/**
 * A column carrying its first card: that one is hidden, so it takes no space,
 * and the two left on show sit at the top of the list.
 */
function column(): { column: HTMLElement; carried: HTMLElement } {
	const root = document.createElement('div');
	root.dataset.kanbanColumn = 'todo';
	const list = document.createElement('div');
	list.dataset.kanbanList = '';
	const carried = card('carried', 0, 0, true);
	list.append(carried, card('b', 0, 100), card('c', 112, 100));
	root.append(list);
	document.body.append(root);
	return { column: root, carried };
}

function pointerEvent(type: string, y: number): PointerEvent {
	const event = new Event(type, { bubbles: true, cancelable: true });
	return Object.assign(event, {
		pointerType: 'touch',
		pointerId: 1,
		isPrimary: true,
		button: 0,
		clientX: 50,
		clientY: y
	}) as unknown as PointerEvent;
}

/** Pick the hidden card up, then move the finger to `y`. */
function carry(carried: HTMLElement, y: number) {
	kanbanDrag.press(pointerEvent('pointerdown', 10), {
		noteId: 'carried',
		columnId: 'todo',
		card: carried,
		index: 0,
		onDrop: vi.fn()
	});
	vi.advanceTimersByTime(300);
	window.dispatchEvent(pointerEvent('pointermove', y));
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	kanbanDrag.cancel();
	vi.useRealTimers();
	document.body.innerHTML = '';
	document.elementFromPoint = () => null;
});

describe('drop target geometry', () => {
	it('aims past the cards on show, ignoring the hidden card being carried', () => {
		const { column: root, carried } = column();
		// The carried card stays in the DOM so the gesture keeps reaching the
		// document; hit testing lands on the column either way.
		document.elementFromPoint = () => root;

		carry(carried, 200);

		// Below both visible cards: index 2. Counting the hidden one would say 3.
		expect(kanbanDrag.target).toEqual({ columnId: 'todo', index: 2 });
	});

	it('aims between the cards on show', () => {
		const { column: root, carried } = column();
		document.elementFromPoint = () => root;

		carry(carried, 120);

		expect(kanbanDrag.target).toEqual({ columnId: 'todo', index: 1 });
	});

	it('keeps the carried card reachable from the document all the way through', () => {
		const { column: root, carried } = column();
		document.elementFromPoint = () => root;

		carry(carried, 200);

		expect(document.contains(carried)).toBe(true);
	});
});
