/**
 * Swipe a sidebar label row to the left to reveal its actions.
 *
 * The drawer itself no longer answers to swipes, so a horizontal drag that
 * starts on a label row belongs to that row alone; a vertical drag is left to
 * the labels list so it keeps scrolling.
 */

/** Movement before a gesture counts as a decided horizontal swipe. */
const DECIDE_PX = 8;
/** How far a row travels at most while the finger drags it. */
const MAX_PX = 88;
/** Releasing past this reveals the row's actions. */
const REVEAL_PX = 44;
/** Below this the row counts as untouched, so the release still opens it. */
const MOVED_PX = 5;

export type LabelSwipeVisual = { labelId: string | null; offsetX: number; dragging: boolean };

export type LabelSwipeHandlers = {
	onPointerDown: (event: PointerEvent, labelId: string) => void;
	onPointerMove: (event: PointerEvent) => void;
	onPointerUp: (event: PointerEvent) => void;
	onPointerCancel: (event: PointerEvent) => void;
	/** True for the click that ends a drag, so the row does not navigate. */
	wasDrag: () => boolean;
};

export function createLabelSwipe(opts: {
	onReveal: (labelId: string) => void;
	/** Reactive sink so Svelte re-renders the row while it is dragged. */
	setVisual: (visual: LabelSwipeVisual) => void;
}): LabelSwipeHandlers {
	let labelId: string | null = null;
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let offsetX = 0;
	let dragging = false;
	let decided = false;
	let dragged = false;

	function publish() {
		opts.setVisual({ labelId, offsetX, dragging });
	}

	function endGesture() {
		pointerId = null;
		decided = false;
		dragging = false;
		offsetX = 0;
	}

	function onPointerDown(event: PointerEvent, id: string) {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		if (pointerId !== null) return;
		dragged = false;
		labelId = id;
		pointerId = event.pointerId;
		startX = event.clientX;
		startY = event.clientY;
		offsetX = 0;
		dragging = false;
		decided = false;
		publish();
	}

	function onPointerMove(event: PointerEvent) {
		if (pointerId === null || event.pointerId !== pointerId) return;
		const dx = event.clientX - startX;
		const dy = event.clientY - startY;
		if (!decided) {
			if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
			if (Math.abs(dy) >= Math.abs(dx)) {
				endGesture();
				publish();
				return;
			}
			decided = true;
			dragging = true;
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		}
		event.preventDefault();
		offsetX = Math.max(-MAX_PX, Math.min(0, dx));
		// A row that never really moved still opens on release, like a tap.
		if (offsetX < -MOVED_PX) dragged = true;
		publish();
	}

	function onPointerUp(event: PointerEvent) {
		if (pointerId === null || event.pointerId !== pointerId) return;
		const reveal = decided && offsetX <= -REVEAL_PX;
		const revealed = labelId;
		releaseCapture(event);
		endGesture();
		publish();
		if (reveal && revealed) opts.onReveal(revealed);
	}

	function onPointerCancel(event: PointerEvent) {
		if (pointerId === null || event.pointerId !== pointerId) return;
		releaseCapture(event);
		endGesture();
		publish();
	}

	function releaseCapture(event: PointerEvent) {
		const node = event.currentTarget;
		if (node instanceof HTMLElement && node.hasPointerCapture?.(event.pointerId)) {
			node.releasePointerCapture(event.pointerId);
		}
	}

	return {
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onPointerCancel,
		wasDrag: () => dragged
	};
}
