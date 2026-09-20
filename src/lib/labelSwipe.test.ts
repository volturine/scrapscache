import { describe, expect, it, vi } from 'vitest';
import { createLabelSwipe, type LabelSwipeVisual } from './labelSwipe';

function session() {
	const row = document.createElement('button');
	const revealed: string[] = [];
	const visuals: LabelSwipeVisual[] = [];
	const swipe = createLabelSwipe({
		onReveal: (labelId) => revealed.push(labelId),
		setVisual: (visual) => visuals.push(visual)
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
		revealed,
		last: () => visuals[visuals.length - 1],
		down: (x: number, y = 100) => swipe.onPointerDown(event(x, y), 'work'),
		move: (x: number, y = 100) => swipe.onPointerMove(event(x, y)),
		up: (x: number, y = 100) => swipe.onPointerUp(event(x, y)),
		cancel: (x: number, y = 100) => swipe.onPointerCancel(event(x, y))
	};
}

describe('createLabelSwipe', () => {
	it('reveals the row actions after a left swipe past the threshold', () => {
		const s = session();
		s.down(200);
		s.move(160);
		expect(s.last()).toEqual({ labelId: 'work', offsetX: -40, dragging: true });
		s.move(140);
		s.up(140);

		expect(s.revealed).toEqual(['work']);
		// The row is back at rest once the actions are up.
		expect(s.last()).toEqual({ labelId: 'work', offsetX: 0, dragging: false });
		expect(s.swipe.wasDrag()).toBe(true);
	});

	it('snaps back without revealing when the swipe stops short', () => {
		const s = session();
		s.down(200);
		s.move(180);
		s.up(180);

		expect(s.revealed).toEqual([]);
		expect(s.last().offsetX).toBe(0);
	});

	it('never follows a rightward drag', () => {
		const s = session();
		s.down(200);
		s.move(260);

		expect(s.last().offsetX).toBe(0);
		expect(s.swipe.wasDrag()).toBe(false);
	});

	it('leaves a vertical drag to the labels list', () => {
		const s = session();
		s.down(200, 100);
		s.move(196, 160);
		s.move(150, 200);
		s.up(150, 200);

		expect(s.revealed).toEqual([]);
		expect(s.last().dragging).toBe(false);
		expect(s.swipe.wasDrag()).toBe(false);
	});

	it('keeps a plain tap navigable', () => {
		const s = session();
		s.down(200);
		s.move(198);
		s.up(198);

		expect(s.swipe.wasDrag()).toBe(false);
	});

	it('drops the gesture when the pointer is cancelled', () => {
		const s = session();
		s.down(200);
		s.move(120);
		s.cancel(120);

		expect(s.revealed).toEqual([]);
		expect(s.last()).toEqual({ labelId: 'work', offsetX: 0, dragging: false });
	});
});
