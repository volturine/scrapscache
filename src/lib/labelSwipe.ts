/**
 * Swipe a sidebar label row to the left to uncover its actions on the right.
 *
 * The row gives up width rather than sliding out of the drawer, so its name
 * stays readable next to the tray. The drawer does not answer to swipes, so a
 * horizontal drag that starts on a row belongs to that row alone; a vertical
 * drag is left to the labels list so it keeps scrolling. One row at a time.
 */

/** Movement before a gesture counts as a decided horizontal swipe. */
const DECIDE_PX = 8;
/** Below this the row counts as untouched, so the release still opens it. */
const MOVED_PX = 5;
/** How much width a row gives up to its actions; matches sidebarStyles.labelTray. */
export const LABEL_TRAY_PX = 88;

export type LabelSwipeVisual = { labelId: string | null; offsetX: number; dragging: boolean };

export type LabelSwipeHandlers = {
	onPointerDown: (event: PointerEvent, labelId: string) => void;
	onPointerMove: (event: PointerEvent) => void;
	onPointerUp: (event: PointerEvent) => void;
	onPointerCancel: (event: PointerEvent) => void;
	/** True once for the click that ends a drag, so the row does not navigate. */
	consumeDrag: () => boolean;
	/** Hide the open actions, e.g. on an outside tap or after one is used. */
	close: () => void;
};

export function createLabelSwipe(opts: {
	/** Reactive sink for the row being dragged. */
	setVisual: (visual: LabelSwipeVisual) => void;
	/** Reactive sink for the row resting with its actions uncovered. */
	setOpen: (labelId: string | null) => void;
}): LabelSwipeHandlers {
	let openId: string | null = null;
	let labelId: string | null = null;
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let baseX = 0;
	let offsetX = 0;
	let dragging = false;
	let decided = false;
	let dragged = false;

	function publish() {
		opts.setVisual({ labelId, offsetX, dragging });
	}

	function setOpen(id: string | null) {
		openId = id;
		opts.setOpen(id);
	}

	function endGesture() {
		pointerId = null;
		decided = false;
		dragging = false;
	}

	function onPointerDown(event: PointerEvent, id: string) {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		if (pointerId !== null) return;
		dragged = false;
		// Touching any row puts the previously open one away. Its own transform
		// comes from `openId`, so it animates back on its own.
		if (openId !== null && openId !== id) setOpen(null);
		labelId = id;
		pointerId = event.pointerId;
		startX = event.clientX;
		startY = event.clientY;
		baseX = openId === id ? -LABEL_TRAY_PX : 0;
		offsetX = baseX;
		dragging = false;
		decided = false;
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
		offsetX = Math.max(-LABEL_TRAY_PX, Math.min(0, baseX + dx));
		// A row that never really moved still opens on release, like a tap.
		if (Math.abs(offsetX - baseX) > MOVED_PX) dragged = true;
		publish();
	}

	function onPointerUp(event: PointerEvent) {
		if (pointerId === null || event.pointerId !== pointerId) return;
		const settled = decided ? offsetX <= -LABEL_TRAY_PX / 2 : openId === labelId;
		releaseCapture(event);
		endGesture();
		setOpen(settled ? labelId : null);
		offsetX = settled ? -LABEL_TRAY_PX : 0;
		publish();
	}

	function onPointerCancel(event: PointerEvent) {
		if (pointerId === null || event.pointerId !== pointerId) return;
		releaseCapture(event);
		endGesture();
		offsetX = openId === labelId ? -LABEL_TRAY_PX : 0;
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
		consumeDrag: () => {
			const was = dragged;
			dragged = false;
			return was;
		},
		close: () => {
			// The gesture is over, so the next tap on the row opens it again.
			dragged = false;
			if (openId === null) return;
			setOpen(null);
			offsetX = 0;
			publish();
		}
	};
}

/** Inline width for a swiped row; the CSS class owns the easing. */
export function labelSwipeStyle(offsetX: number, dragging: boolean): string {
	const width = offsetX === 0 ? '' : `width: calc(100% - ${-offsetX}px);`;
	return dragging ? `${width} transition: none;` : width;
}
