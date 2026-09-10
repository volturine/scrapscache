/**
 * One pointer-driven drag path for Kanban cards, shared by mouse, pen and touch.
 *
 * Native HTML drag-and-drop is deliberately unused. Its drag image is a browser
 * snapshot — opaque square corners, black embedded images in Safari — and iOS
 * never starts one from touch at all. Here the press is tracked with pointer
 * events, the card leaves its column, and a ghost element follows the pointer,
 * so every device gets the same picked-up card and the same drop preview.
 */

import { PHONE_MEDIA } from '$lib/appViewport';
import { isSidebarEdgeStart } from '$lib/sidebarSwipe';

export type KanbanDropTarget = { columnId: string; index: number };

/** Touch and pen pick a card up by holding still; a plain swipe still scrolls. */
const HOLD_MS = 220;
/** Moving further than this before the hold fires means the user meant to scroll. */
const HOLD_CANCEL_PX = 10;
/** A mouse has no hold delay, just a threshold that separates a drag from a click. */
const MOUSE_START_PX = 5;
/** Overhang at which a scroller follows the carried card at full speed. */
const OVERHANG_FULL_PX = 90;
/** Peak auto-scroll speed, in pixels per frame. */
const EDGE_SPEED = 16;
/** Slowest a scroller creeps once the card hangs over its edge at all. */
const MIN_SCROLL_RATIO = 0.2;
/** A finger lifts the card clear of itself so the drop preview stays visible. */
const TOUCH_LIFT_PX = 12;
/** The click that follows a drag release must not open the note. */
const CLICK_SUPPRESS_MS = 350;

export type KanbanCardPress = {
	noteId: string;
	columnId: string;
	card: HTMLElement;
	index: number;
	/**
	 * Called once the card is released, with everything it needs as arguments.
	 * The card is unmounted by then — it moved into the ghost — so the handler
	 * must belong to the board, not to the card's own list item.
	 */
	onDrop: (noteId: string, columnId: string, target: KanbanDropTarget | null) => void;
};

/**
 * Which slot the pointer is over, from a column's laid-out card geometry.
 *
 * `slotIndex` / `slotSpan` describe the gap the drop preview already opened in
 * this column: the cards below it sit that much lower, so the gap is subtracted
 * back out and the answer stays a function of the pointer alone. Without that,
 * every opened gap would move the card it was measured from and the preview
 * would flip between two slots.
 */
export function dropIndexAt(
	localY: number,
	tops: number[],
	heights: number[],
	slotIndex: number,
	slotSpan: number
): number {
	for (let index = 0; index < tops.length; index += 1) {
		const shift = slotIndex >= 0 && index >= slotIndex ? slotSpan : 0;
		if (localY < tops[index] - shift + heights[index] / 2) return index;
	}
	return tops.length;
}

function columnAt(x: number, y: number): HTMLElement | null {
	const hit = document.elementFromPoint(x, y);
	return hit instanceof Element ? hit.closest<HTMLElement>('[data-kanban-column]') : null;
}

function scrollerFor(start: HTMLElement | null, axis: 'x' | 'y'): HTMLElement | null {
	for (let node = start; node; node = node.parentElement) {
		const style = getComputedStyle(node);
		const overflow = axis === 'x' ? style.overflowX : style.overflowY;
		if (overflow !== 'auto' && overflow !== 'scroll') continue;
		const room =
			axis === 'x' ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight;
		if (room > 1) return node;
	}
	return null;
}

/**
 * How fast a scroller should follow the carried card along one axis, in pixels
 * per frame. Negative moves towards the scroller's start.
 *
 * The card drives this, not the finger. On a phone a column fills the screen,
 * so a finger is nearly always within any sensible edge band — the board would
 * pan the whole time a note is carried. Measuring the card instead means
 * nothing scrolls until the note itself is pushed past an edge, which is also
 * what the gesture looks like: shove the note off the side to go there.
 */
export function overhangSpeed(
	cardStart: number,
	cardEnd: number,
	viewStart: number,
	viewEnd: number
): number {
	const beforeStart = viewStart - cardStart;
	const afterEnd = cardEnd - viewEnd;
	if (beforeStart <= 0 && afterEnd <= 0) return 0;
	// A card taller or wider than the view hangs over both ends; follow the
	// side it hangs over further.
	const overhang = Math.max(beforeStart, afterEnd);
	const direction = afterEnd > beforeStart ? 1 : -1;
	const ratio = Math.max(Math.min(overhang / OVERHANG_FULL_PX, 1), MIN_SCROLL_RATIO);
	return direction * EDGE_SPEED * ratio;
}

type Press = KanbanCardPress & {
	pointerId: number;
	pointerType: string;
	startX: number;
	startY: number;
	grabX: number;
	grabY: number;
	scrollX: HTMLElement | null;
	scrollY: HTMLElement | null;
	hold: ReturnType<typeof setTimeout> | null;
	dragging: boolean;
};

class KanbanDragController {
	/** The card being carried, or null when nothing is picked up. */
	noteId = $state<string | null>(null);
	sourceColumnId = $state<string | null>(null);
	/** Where the card lands if the pointer is released now. */
	target = $state<KanbanDropTarget | null>(null);
	/** Ghost geometry: the card's own size, and its top-left in viewport space. */
	width = $state(0);
	height = $state(0);
	x = $state(0);
	y = $state(0);
	lifted = $state(false);

	#press: Press | null = null;
	#pointerX = 0;
	#pointerY = 0;
	#frame = 0;
	#clickSuppressedUntil = 0;

	get active(): boolean {
		return this.noteId !== null;
	}

	/** True right after a drop, while the release still wants to fire a click. */
	get suppressedClick(): boolean {
		return performance.now() < this.#clickSuppressedUntil;
	}

	/** Start tracking a press on a card. Nothing is picked up until it qualifies. */
	press(event: PointerEvent, card: KanbanCardPress): void {
		if (this.#press || !event.isPrimary) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		// The left screen edge belongs to the sidebar swipe on phones.
		if (
			event.pointerType !== 'mouse' &&
			window.matchMedia(PHONE_MEDIA).matches &&
			isSidebarEdgeStart(event.clientX)
		)
			return;

		const rect = card.card.getBoundingClientRect();
		this.#press = {
			...card,
			pointerId: event.pointerId,
			pointerType: event.pointerType,
			startX: event.clientX,
			startY: event.clientY,
			grabX: event.clientX - rect.left,
			grabY: event.clientY - rect.top,
			scrollX: null,
			scrollY: null,
			hold: null,
			dragging: false
		};
		this.width = rect.width;
		this.height = rect.height;
		this.#pointerX = event.clientX;
		this.#pointerY = event.clientY;

		window.addEventListener('pointermove', this.#onPointerMove);
		window.addEventListener('pointerup', this.#onPointerUp);
		window.addEventListener('pointercancel', this.#onPointerCancel);
		if (event.pointerType !== 'mouse') {
			this.#press.hold = setTimeout(() => this.#lift(), HOLD_MS);
		}
	}

	/** Abandon the gesture with no drop, e.g. when the board unmounts. */
	cancel(): void {
		this.#finish(false);
		// Nothing was dropped, so no click needs swallowing either.
		this.#clickSuppressedUntil = 0;
	}

	#lift(): void {
		const press = this.#press;
		if (!press || press.dragging) return;
		press.dragging = true;

		const column = press.card.closest<HTMLElement>('[data-kanban-column]');
		// Resolved from the column, never from the card: a card's own overflow
		// would otherwise capture the auto-scroll meant for the board.
		press.scrollX = scrollerFor(column, 'x');
		press.scrollY = scrollerFor(column, 'y');

		this.noteId = press.noteId;
		this.sourceColumnId = press.columnId;
		this.target = { columnId: press.columnId, index: press.index };
		this.lifted = false;
		this.#move(this.#pointerX, this.#pointerY);

		document.documentElement.classList.add('kanban-dragging');
		// Capturing and non-passive: a carried card owns the gesture outright, so
		// the board can never pan under it while it is also being dragged.
		document.addEventListener('touchmove', preventDefault, { passive: false, capture: true });
		window.addEventListener('contextmenu', preventDefault);
		navigator.vibrate?.(8);
		// One frame later the ghost has its start transform and can animate in.
		requestAnimationFrame(() => {
			if (this.active) this.lifted = true;
		});
		this.#frame = requestAnimationFrame(this.#tick);
	}

	#move(x: number, y: number): void {
		const press = this.#press;
		if (!press) return;
		this.#pointerX = x;
		this.#pointerY = y;
		this.x = x - press.grabX;
		this.y = y - press.grabY - (press.pointerType === 'mouse' ? 0 : TOUCH_LIFT_PX);
	}

	#retarget(): void {
		const press = this.#press;
		if (!press?.dragging) return;
		const column = columnAt(this.#pointerX, this.#pointerY);
		// Off the board entirely: keep the last preview so the drop is never a
		// surprise — what the user last saw is where the card goes.
		if (!column?.dataset.kanbanColumn) return;
		const list = column.querySelector<HTMLElement>('[data-kanban-list]');
		if (!list) return;

		const children = [...list.children] as HTMLElement[];
		const slot = children.find((child) => child.hasAttribute('data-kanban-slot')) ?? null;
		const cards = children.filter((child) => child.hasAttribute('data-kanban-card'));
		const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
		// offsetTop, not a client rect: cards slide into place with a transform
		// while the preview moves, and only the settled layout is a stable ruler.
		const index = dropIndexAt(
			this.#pointerY - list.getBoundingClientRect().top,
			cards.map((card) => card.offsetTop),
			cards.map((card) => card.offsetHeight),
			slot ? children.indexOf(slot) : -1,
			slot ? slot.offsetHeight + gap : 0
		);

		const columnId = column.dataset.kanbanColumn;
		if (this.target?.columnId === columnId && this.target.index === index) return;
		this.target = { columnId, index };
	}

	/** Follow the card's overhang on one axis. Returns true if the scroller moved. */
	#followCard(el: HTMLElement | null, axis: 'x' | 'y'): boolean {
		if (!el) return false;
		const rect = el.getBoundingClientRect();
		const speed =
			axis === 'x'
				? overhangSpeed(this.x, this.x + this.width, rect.left, rect.right)
				: overhangSpeed(this.y, this.y + this.height, rect.top, rect.bottom);
		if (speed === 0) return false;

		const before = axis === 'x' ? el.scrollLeft : el.scrollTop;
		if (axis === 'x') el.scrollLeft = before + speed;
		else el.scrollTop = before + speed;
		return (axis === 'x' ? el.scrollLeft : el.scrollTop) !== before;
	}

	#tick = (): void => {
		const press = this.#press;
		if (!press?.dragging) return;
		this.#frame = requestAnimationFrame(this.#tick);
		const scrolled = this.#followCard(press.scrollX, 'x') || this.#followCard(press.scrollY, 'y');
		// Scrolling slides new cards under a still pointer, so re-aim then too.
		if (scrolled) this.#retarget();
	};

	#onPointerMove = (event: PointerEvent): void => {
		const press = this.#press;
		if (!press || event.pointerId !== press.pointerId) return;

		if (!press.dragging) {
			const moved = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
			this.#pointerX = event.clientX;
			this.#pointerY = event.clientY;
			if (press.pointerType === 'mouse') {
				if (moved < MOUSE_START_PX) return;
				this.#lift();
			} else {
				// Still waiting on the hold: this is a scroll, so let the page have it.
				if (moved > HOLD_CANCEL_PX) this.#finish(false);
				return;
			}
		}

		event.preventDefault();
		this.#move(event.clientX, event.clientY);
		this.#retarget();
	};

	#onPointerUp = (event: PointerEvent): void => {
		const press = this.#press;
		if (!press || event.pointerId !== press.pointerId) return;
		const target = press.dragging ? this.target : null;
		const dropped = press.dragging;
		this.#finish(dropped);
		if (dropped) press.onDrop(press.noteId, press.columnId, target);
	};

	#onPointerCancel = (event: PointerEvent): void => {
		if (event.pointerId !== this.#press?.pointerId) return;
		this.#finish(false);
	};

	#finish(dragged: boolean): void {
		const press = this.#press;
		this.#press = null;
		if (press?.hold) clearTimeout(press.hold);
		window.removeEventListener('pointermove', this.#onPointerMove);
		window.removeEventListener('pointerup', this.#onPointerUp);
		window.removeEventListener('pointercancel', this.#onPointerCancel);
		document.removeEventListener('touchmove', preventDefault, { capture: true });
		window.removeEventListener('contextmenu', preventDefault);
		if (this.#frame) cancelAnimationFrame(this.#frame);
		this.#frame = 0;
		document.documentElement.classList.remove('kanban-dragging');
		if (dragged) this.#clickSuppressedUntil = performance.now() + CLICK_SUPPRESS_MS;
		this.noteId = null;
		this.sourceColumnId = null;
		this.target = null;
		this.lifted = false;
	}
}

function preventDefault(event: Event): void {
	event.preventDefault();
}

export const kanbanDrag = new KanbanDragController();
