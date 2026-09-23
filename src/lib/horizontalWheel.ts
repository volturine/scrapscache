/**
 * Horizontal wheel support for every sideways scroller.
 *
 * Mice only emit deltaY, so Shift+wheel — the standard modifier combo —
 * maps the vertical wheel onto the horizontal axis. A real horizontal
 * wheel (trackpad) keeps its own deltaX.
 */

const installedTargets = new WeakSet<EventTarget>();

/** Horizontal pan distance for this wheel event, or null when it is not horizontal. */
export function horizontalWheelDelta(event: WheelEvent): number | null {
	const absX = Math.abs(event.deltaX);
	const absY = Math.abs(event.deltaY);
	if (event.shiftKey) {
		// Browsers that already swap axes under Shift report a dominant deltaX.
		if (absX > 0 && absX >= absY) return event.deltaX;
		if (absY > 0) return event.deltaY;
		return null;
	}
	if (absX > 0 && absX > absY) return event.deltaX;
	return null;
}

function isHorizontalScroller(el: HTMLElement): boolean {
	if (el.scrollWidth <= el.clientWidth + 1) return false;
	// Attribute markers for strips whose overflow comes from stylesheets (absent in tests).
	if (el.hasAttribute('data-markdown-table-container') || el.hasAttribute('data-card-hscroll')) {
		return true;
	}
	const overflowX = getComputedStyle(el).overflowX;
	return overflowX === 'auto' || overflowX === 'scroll';
}

function walkToScroller(from: Element | null): HTMLElement | null {
	for (let el: Element | null = from; el; el = el.parentElement) {
		if (el instanceof HTMLElement && isHorizontalScroller(el)) return el;
	}
	return null;
}

/**
 * Nearest horizontal scroller at a point. Walks the event target first, then
 * hit-tests through overlays (the gallery card shield covers wide tables).
 */
export function horizontalScrollerAt(
	x: number,
	y: number,
	from?: EventTarget | null
): HTMLElement | null {
	if (from instanceof Element) {
		const found = walkToScroller(from);
		if (found) return found;
	}
	const stack =
		typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
	for (const el of stack) {
		if (!(el instanceof HTMLElement)) continue;
		const found = walkToScroller(el);
		if (found) return found;
	}
	return null;
}

/** Scroll the horizontal scroller under the pointer; true when the event was consumed. */
export function panHorizontalWheel(event: WheelEvent): boolean {
	if (event.defaultPrevented) return false;
	const delta = horizontalWheelDelta(event);
	if (delta === null || delta === 0) return false;
	const scroller = horizontalScrollerAt(event.clientX, event.clientY, event.target);
	if (!scroller) return false;
	scroller.scrollLeft += delta;
	event.preventDefault();
	return true;
}

/** One window-level listener so every horizontal strip answers Shift+wheel. */
export function installHorizontalWheel(target: EventTarget = window): () => void {
	if (installedTargets.has(target)) return () => {};
	installedTargets.add(target);
	const onWheel = (event: Event) => {
		panHorizontalWheel(event as WheelEvent);
	};
	target.addEventListener('wheel', onWheel, { passive: false });
	return () => {
		installedTargets.delete(target);
		target.removeEventListener('wheel', onWheel);
	};
}
