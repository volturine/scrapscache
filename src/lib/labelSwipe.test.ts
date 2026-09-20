import { describe, expect, it, vi } from 'vitest';
import { createLabelSwipe, LABEL_TRAY_PX, type LabelSwipeVisual } from './labelSwipe';

function session() {
	const row = document.createElement('button');
	const opened: (string | null)[] = [];
	const visuals: LabelSwipeVisual[] = [];
	const swipe = createLabelSwipe({
		setVisual: (visual) => visuals.push(visual),
		setOpen: (labelId) => opened.push(labelId)
	});

	function event(clientX: number, clientY: number): PointerEvent {
		return {
			pointerId: 1,
			pointerType: 'touch',
			button: 0,
			clientX,
			clientY,
			currentTarget: row,
			preventDefault: vi.fn()
		} as unknown as PointerEvent;
	}

	return {
		swipe,
		opened,
		open: () => opened[opened.length - 1] ?? null,
		last: () => visuals[visuals.length - 1],
		down: (x: number, y = 100, id = 'work') => swipe.onPointerDown(event(x, y), id),
		move: (x: number, y = 100) => swipe.onPointerMove(event(x, y)),
		up: (x: number, y = 100) => swipe.onPointerUp(event(x, y)),
		cancel: (x: number, y = 100) => swipe.onPointerCancel(event(x, y))
	};
}

/** A left swipe that settles the row's actions open. */
function reveal(s: ReturnType<typeof session>, id = 'work') {
	s.down(300, 100, id);
	s.move(260);
	s.move(200);
	s.up(200);
}

describe('createLabelSwipe', () => {
	it('uncovers the row actions after a left swipe past half the tray', () => {
		const s = session();
		s.down(300);
		s.move(260);
		expect(s.last()).toEqual({ labelId: 'work', offsetX: -40, dragging: true });
		s.move(150);
		// The row never travels further than the tray it uncovers.
		expect(s.last().offsetX).toBe(-LABEL_TRAY_PX);
		s.up(150);

		expect(s.open()).toBe('work');
		expect(s.last()).toEqual({ labelId: 'work', offsetX: -LABEL_TRAY_PX, dragging: false });
		expect(s.swipe.consumeDrag()).toBe(true);
	});

	it('snaps back without uncovering when the swipe stops short', () => {
		const s = session();
		s.down(300);
		s.move(280);
		s.up(280);

		expect(s.open()).toBe(null);
		expect(s.last().offsetX).toBe(0);
	});

	it('keeps the actions open for a tap on the row', () => {
		const s = session();
		reveal(s);
		s.down(300);
		s.up(300);

		expect(s.open()).toBe('work');
		expect(s.last().offsetX).toBe(-LABEL_TRAY_PX);
	});

	it('swipes an open row back to rest', () => {
		const s = session();
		reveal(s);
		s.down(100);
		s.move(160);
		s.move(200);
		s.up(200);

		expect(s.open()).toBe(null);
		expect(s.last().offsetX).toBe(0);
	});

	it('puts one row away when another is touched', () => {
		const s = session();
		reveal(s);
		s.down(300, 100, 'home');

		expect(s.open()).toBe(null);
	});

	it('never follows a rightward drag on a row at rest', () => {
		const s = session();
		s.down(200);
		s.move(260);

		expect(s.last().offsetX).toBe(0);
		expect(s.swipe.consumeDrag()).toBe(false);
	});

	it('leaves a vertical drag to the labels list', () => {
		const s = session();
		s.down(200, 100);
		s.move(196, 160);
		s.move(150, 200);
		s.up(150, 200);

		expect(s.open()).toBe(null);
		expect(s.last().dragging).toBe(false);
		expect(s.swipe.consumeDrag()).toBe(false);
	});

	it('keeps a plain tap navigable', () => {
		const s = session();
		s.down(200);
		s.move(198);
		s.up(198);

		expect(s.swipe.consumeDrag()).toBe(false);
	});

	it('closes the open row on request', () => {
		const s = session();
		reveal(s);
		s.swipe.close();

		expect(s.open()).toBe(null);
		expect(s.last().offsetX).toBe(0);
	});

	it('returns an open row to its tray when the pointer is cancelled', () => {
		const s = session();
		reveal(s);
		s.down(300);
		s.move(320);
		s.cancel(320);

		expect(s.open()).toBe('work');
		expect(s.last().offsetX).toBe(-LABEL_TRAY_PX);
	});
});
