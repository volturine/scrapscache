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

/** A feed with room to scroll, wrapped around a column. */
function feed(child: HTMLElement): { feed: HTMLElement; scrollTop: () => number } {
	const el = document.createElement('div');
	el.style.overflowY = 'scroll';
	Object.defineProperties(el, {
		scrollHeight: { value: 2000 },
		clientHeight: { value: 600 }
	});
	// jsdom does no layout, so scrolling is recorded rather than performed.
	let top = 0;
	Object.defineProperty(el, 'scrollTop', { get: () => top, set: (value: number) => (top = value) });
	// A phone feed: the board sits under the top bar, so it is shorter than the screen.
	el.getBoundingClientRect = () => new DOMRect(0, 0, 390, 600);
	el.append(child);
	document.body.append(el);
	return { feed: el, scrollTop: () => top };
}

/** Carry a card from `grabY` to `toY` and let a few frames run. */
function drag(card: HTMLElement, grabY: number, toY: number) {
	kanbanDrag.press(pointerEvent('pointerdown', grabY), {
		noteId: 'carried',
		columnId: 'todo',
		card,
		index: 0,
		onDrop: vi.fn()
	});
	vi.advanceTimersByTime(300);
	window.dispatchEvent(pointerEvent('pointermove', toY));
	vi.advanceTimersByTime(100);
}

describe('scrolling the list under a carried card', () => {
	// A tall card, as one with a drawing or a photo on it is: over half the feed.
	const TALL = 320;

	function tallColumn() {
		const { column: root, carried } = column();
		carried.getBoundingClientRect = () => new DOMRect(16, 100, 288, TALL);
		return { root, carried, ...feed(root) };
	}

	it('holds the list still for a finger in the middle, wherever the card was held', () => {
		const held = tallColumn();
		document.elementFromPoint = () => held.root;

		// Held by its top edge: the card's own bottom edge hangs well past the
		// feed from here, though the finger is nowhere near the bottom.
		drag(held.carried, 110, 420);
		expect(held.scrollTop()).toBe(0);

		kanbanDrag.cancel();
		// Held by its bottom edge instead. Same finger, same result.
		drag(held.carried, 410, 420);
		expect(held.scrollTop()).toBe(0);
	});

	it('runs the list down once the finger reaches the bottom edge', () => {
		const held = tallColumn();
		document.elementFromPoint = () => held.root;

		drag(held.carried, 110, 590);

		expect(held.scrollTop()).toBeGreaterThan(0);
	});

	it('runs the list up once the finger reaches the top edge', () => {
		const held = tallColumn();
		document.elementFromPoint = () => held.root;
		held.feed.scrollTop = 500;

		drag(held.carried, 110, 10);

		expect(held.scrollTop()).toBeLessThan(500);
	});
});

describe('what the drop aims by', () => {
	/** A card of real height, so holding it top or bottom is a long way apart. */
	function heldCard() {
		const { column: root, carried } = column();
		carried.getBoundingClientRect = () => new DOMRect(16, 0, 288, 150);
		document.elementFromPoint = () => root;
		return carried;
	}

	function aimAt(card: HTMLElement, grabY: number, fingerY: number) {
		kanbanDrag.press(pointerEvent('pointerdown', grabY), {
			noteId: 'carried',
			columnId: 'todo',
			card,
			index: 0,
			onDrop: vi.fn()
		});
		vi.advanceTimersByTime(300);
		window.dispatchEvent(pointerEvent('pointermove', fingerY));
		return kanbanDrag.target;
	}

	it('lands by where the card is, not by where the finger holds it', () => {
		const card = heldCard();
		// Held at the top, finger at 200: the card's top edge sits at 178.
		const byTheTop = aimAt(card, 10, 200);
		kanbanDrag.cancel();
		// Held near the bottom, finger 130px lower: the card's top edge is the
		// same 178, and so is the slot it opens.
		const byTheBottom = aimAt(card, 140, 330);

		expect(byTheTop).toEqual({ columnId: 'todo', index: 2 });
		expect(byTheBottom).toEqual(byTheTop);
	});

	it('moves the slot as the card itself moves, finger held still', () => {
		const card = heldCard();

		// Two grabs, same finger: the lower grab carries the card higher up the
		// column, so it aims at an earlier slot.
		const low = aimAt(card, 10, 200);
		kanbanDrag.cancel();
		const high = aimAt(card, 140, 200);

		expect(low).toEqual({ columnId: 'todo', index: 2 });
		expect(high).toEqual({ columnId: 'todo', index: 0 });
	});
});

describe('drop target geometry with the preview open below the carried card', () => {
	/**
	 * Dragging downwards leaves the hidden card above the preview slot. The
	 * cards below the slot are pushed down by it; the drop index must read
	 * through that, or every move re-opens the gap somewhere else and the
	 * column jitters under the finger.
	 */
	function columnWithSlotBelow(): { column: HTMLElement; carried: HTMLElement } {
		const root = document.createElement('div');
		root.dataset.kanbanColumn = 'todo';
		const list = document.createElement('div');
		list.dataset.kanbanList = '';

		const carried = card('carried', 0, 0, true);
		const first = card('b', 0, 100);
		const slot = document.createElement('div');
		slot.dataset.kanbanSlot = '';
		Object.defineProperties(slot, { offsetTop: { value: 112 }, offsetHeight: { value: 150 } });
		// Pushed down by the slot's 150px and the 12px gap it brings with it.
		const second = card('c', 274, 100);

		list.append(carried, first, slot, second);
		root.append(list);
		document.body.append(root);
		return { column: root, carried };
	}

	it('aims by where the cards would settle, not where the slot pushed them', () => {
		const { column: root, carried } = columnWithSlotBelow();
		document.elementFromPoint = () => root;

		// Settled, the two cards on show sit at 0-100 and 112-212: a finger at
		// 200 is past the second one's middle, so the card lands last.
		carry(carried, 200);

		expect(kanbanDrag.target).toEqual({ columnId: 'todo', index: 2 });
	});
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
