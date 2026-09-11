/**
 * One pointer-driven drag path for Kanban cards, shared by mouse, pen and touch.
 *
 * Native HTML drag-and-drop is deliberately unused. Its drag image is a browser
 * snapshot — opaque square corners, black embedded images in Safari — and iOS
 * never starts one from touch at all. Here the press is tracked with pointer
 * events, the card hides in its column, and a ghost element follows the pointer,
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
const EDGE_SPEED = 12;
/** Slowest a scroller creeps once the card hangs over its edge at all. */
const MIN_SCROLL_RATIO = 0.2;
/** How far the carried card must hang past a side before the board turns a page. */
const PAGE_TRIGGER_PX = 16;
/** Quiet time after a page, so holding the card at a side steps column by column. */
const PAGE_COOLDOWN_MS = 500;
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
	 * The card is hidden by then — it shows as the ghost — so the handler must
	 * belong to the board, not to the card's own list item.
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

/**
 * Where the board should scroll to put the next column into view, or null when
 * there is nothing further that way.
 *
 * Columns are page-sized on a phone, so the board turns pages instead of
 * sliding continuously: a carried card that hangs past a side steps the board
 * exactly one column and then waits. Continuous scrolling at a speed that
 * feels responsive on a desktop board flies through three phone columns a
 * second, which reads as the board fighting the finger.
 */
export function pagedScrollLeft(
	scrollLeft: number,
	maxScrollLeft: number,
	columnStarts: number[],
	direction: 1 | -1
): number | null {
	const settled = 4;
	const starts = [...columnStarts].sort((a, b) => a - b);
	const next =
		direction === 1
			? starts.find((start) => start > scrollLeft + settled)
			: starts.findLast((start) => start < scrollLeft - settled);
	// Past the last column start there is still the board's own tail — the
	// "add label column" affordance — so run to the end rather than stopping.
	const goal = next ?? (direction === 1 ? maxScrollLeft : 0);
	const clamped = Math.min(Math.max(goal, 0), maxScrollLeft);
	return Math.abs(clamped - scrollLeft) <= settled ? null : clamped;
}

type Press = KanbanCardPress & {
	pointerId: number;
	pointerType: string;
	startX: number;
	startY: number;
	grabX: number;
	grabY: number;
	/** Last seen pointer x, so a board pan can follow the finger one to one. */
	lastX: number;
	scrollX: HTMLElement | null;
	scrollY: HTMLElement | null;
	hold: ReturnType<typeof setTimeout> | null;
	dragging: boolean;
	/** Swiping the board sideways from this card instead of carrying it. */
	panning: boolean;
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
	#pagedAt = 0;
	#scrolledX = 0;
	#scrolledY = 0;

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
		const column = card.card.closest<HTMLElement>('[data-kanban-column]');
		this.#press = {
			...card,
			pointerId: event.pointerId,
			pointerType: event.pointerType,
			startX: event.clientX,
			startY: event.clientY,
			lastX: event.clientX,
			grabX: event.clientX - rect.left,
			grabY: event.clientY - rect.top,
			// Resolved from the column, never from the card: a card's own overflow
			// would otherwise capture the scrolling meant for the board.
			scrollX: scrollerFor(column, 'x'),
			scrollY: scrollerFor(column, 'y'),
			hold: null,
			dragging: false,
			panning: false
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

		// The board often rests part way between two columns, so a card can be
		// picked up already hanging over a side. Start the page cooldown here:
		// the board holds still until the card is deliberately pushed somewhere.
		this.#pagedAt = performance.now();
		this.#scrolledX = press.scrollX?.scrollLeft ?? 0;
		this.#scrolledY = press.scrollY?.scrollTop ?? 0;
		this.noteId = press.noteId;
		this.sourceColumnId = press.columnId;
		this.target = { columnId: press.columnId, index: press.index };
		this.lifted = false;
		this.#move(this.#pointerX, this.#pointerY);

		document.documentElement.classList.add('kanban-dragging');
		// Touch drags also close the scrollers' overflow, because a browser that
		// already latched a pan keeps running it through a cancelled touchmove.
		if (press.pointerType !== 'mouse')
			document.documentElement.classList.add('kanban-dragging-touch');
		// Capturing and non-passive: a carried card owns the gesture outright, so
		// nothing can scroll under it while it is being carried. The card itself
		// listens too, because every touch event of this gesture is dispatched at
		// the element the finger first landed on, whatever it is over now.
		document.addEventListener('touchmove', preventDefault, { passive: false, capture: true });
		press.card.addEventListener('touchmove', preventDefault, { passive: false });
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
		// The carried card is still in the list, hidden; it holds no space and is
		// no longer something to aim above or below.
		const cards = children.filter(
			(child) =>
				child.hasAttribute('data-kanban-card') && !child.hasAttribute('data-kanban-carried')
		);
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

	/** Follow the card's vertical overhang, a column being a list rather than a page. */
	#followCard(el: HTMLElement | null): void {
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const speed = overhangSpeed(this.y, this.y + this.height, rect.top, rect.bottom);
		if (speed !== 0) el.scrollTop += speed;
	}

	/** Turn one board page when the carried card hangs past a side. */
	#pageBoard(el: HTMLElement | null): void {
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const pastStart = rect.left - this.x;
		const pastEnd = this.x + this.width - rect.right;
		const direction =
			pastEnd > PAGE_TRIGGER_PX && pastEnd >= pastStart ? 1 : pastStart > PAGE_TRIGGER_PX ? -1 : 0;
		if (direction === 0) return;

		const now = performance.now();
		if (now - this.#pagedAt < PAGE_COOLDOWN_MS) return;

		const padding = Number.parseFloat(getComputedStyle(el).paddingLeft) || 0;
		const starts = [...el.querySelectorAll<HTMLElement>('[data-kanban-column]')].map(
			(column) => el.scrollLeft + column.getBoundingClientRect().left - rect.left - padding
		);
		const goal = pagedScrollLeft(el.scrollLeft, el.scrollWidth - el.clientWidth, starts, direction);
		if (goal === null) return;

		this.#pagedAt = now;
		el.scrollTo({ left: goal, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
	}

	#tick = (): void => {
		const press = this.#press;
		if (!press?.dragging) return;
		this.#frame = requestAnimationFrame(this.#tick);
		this.#pageBoard(press.scrollX);
		this.#followCard(press.scrollY);

		// Any board movement — this frame's or the tail of a page still gliding —
		// puts different cards under a still finger, so re-aim whenever it moved.
		const scrollX = press.scrollX?.scrollLeft ?? 0;
		const scrollY = press.scrollY?.scrollTop ?? 0;
		if (scrollX === this.#scrolledX && scrollY === this.#scrolledY) return;
		this.#scrolledX = scrollX;
		this.#scrolledY = scrollY;
		this.#retarget();
	};

	#onPointerMove = (event: PointerEvent): void => {
		const press = this.#press;
		if (!press || event.pointerId !== press.pointerId) return;

		if (!press.dragging) {
			this.#pointerX = event.clientX;
			this.#pointerY = event.clientY;
			if (press.pointerType === 'mouse') {
				const moved = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
				if (moved < MOUSE_START_PX) return;
				this.#lift();
			} else {
				this.#panBoard(event);
				return;
			}
		}

		event.preventDefault();
		this.#move(event.clientX, event.clientY);
		this.#retarget();
	};

	/**
	 * A swipe that starts on a card, before any card is picked up.
	 *
	 * Cards only allow the browser to pan the page, so a sideways swipe arrives
	 * here instead: carry the board with the finger one to one. A swipe that is
	 * mostly vertical is the page's, and the press is dropped so the browser can
	 * scroll it with its own momentum.
	 */
	#panBoard(event: PointerEvent): void {
		const press = this.#press;
		if (!press) return;
		const dx = event.clientX - press.startX;
		const dy = event.clientY - press.startY;

		if (!press.panning) {
			if (Math.hypot(dx, dy) <= HOLD_CANCEL_PX) return;
			if (press.hold) clearTimeout(press.hold);
			press.hold = null;
			if (Math.abs(dx) <= Math.abs(dy) || !press.scrollX) {
				this.#finish(false);
				return;
			}
			press.panning = true;
		}

		if (press.scrollX) press.scrollX.scrollLeft -= event.clientX - press.lastX;
		press.lastX = event.clientX;
	}

	#onPointerUp = (event: PointerEvent): void => {
		const press = this.#press;
		if (!press || event.pointerId !== press.pointerId) return;
		const target = press.dragging ? this.target : null;
		const dropped = press.dragging;
		// A pan ends on the card it started on, and must not open that note.
		this.#finish(dropped || press.panning);
		if (dropped) press.onDrop(press.noteId, press.columnId, target);
	};

	#onPointerCancel = (event: PointerEvent): void => {
		if (event.pointerId !== this.#press?.pointerId) return;
		this.#finish(false);
	};

	/** Tear the gesture down. `swallowClick` covers a drop and a board pan alike. */
	#finish(swallowClick: boolean): void {
		const press = this.#press;
		this.#press = null;
		if (press?.hold) clearTimeout(press.hold);
		window.removeEventListener('pointermove', this.#onPointerMove);
		window.removeEventListener('pointerup', this.#onPointerUp);
		window.removeEventListener('pointercancel', this.#onPointerCancel);
		document.removeEventListener('touchmove', preventDefault, { capture: true });
		press?.card.removeEventListener('touchmove', preventDefault);
		window.removeEventListener('contextmenu', preventDefault);
		if (this.#frame) cancelAnimationFrame(this.#frame);
		this.#frame = 0;
		document.documentElement.classList.remove('kanban-dragging', 'kanban-dragging-touch');
		if (swallowClick) this.#clickSuppressedUntil = performance.now() + CLICK_SUPPRESS_MS;
		this.noteId = null;
		this.sourceColumnId = null;
		this.target = null;
		this.lifted = false;
	}
}

function preventDefault(event: Event): void {
	event.preventDefault();
}

function prefersReducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const kanbanDrag = new KanbanDragController();
