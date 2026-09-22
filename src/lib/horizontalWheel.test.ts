import { afterEach, describe, expect, it } from 'vitest';
import {
	horizontalScrollerAt,
	horizontalWheelDelta,
	installHorizontalWheel,
	panHorizontalWheel
} from './horizontalWheel';

function wheel(init: WheelEventInit = {}): WheelEvent {
	return new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
}

function scroller(overrides: Partial<HTMLElement> = {}): HTMLElement {
	const el = document.createElement('div');
	Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => 400 });
	Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => 100 });
	Object.defineProperty(el, 'scrollLeft', { configurable: true, writable: true, value: 0 });
	el.style.overflowX = 'auto';
	Object.assign(el, overrides);
	return el;
}

describe('horizontalWheelDelta', () => {
	it('maps Shift+vertical wheel onto the horizontal axis', () => {
		expect(horizontalWheelDelta(wheel({ shiftKey: true, deltaY: 40, deltaX: 0 }))).toBe(40);
		expect(horizontalWheelDelta(wheel({ shiftKey: true, deltaY: -15, deltaX: 0 }))).toBe(-15);
	});

	it('prefers a swapped Shift deltaX when the browser already rotated the axes', () => {
		expect(horizontalWheelDelta(wheel({ shiftKey: true, deltaX: 30, deltaY: 30 }))).toBe(30);
	});

	it('keeps a real horizontal wheel without a modifier', () => {
		expect(horizontalWheelDelta(wheel({ deltaX: 25, deltaY: 2 }))).toBe(25);
		expect(horizontalWheelDelta(wheel({ deltaX: 0, deltaY: 50 }))).toBeNull();
		expect(horizontalWheelDelta(wheel({ shiftKey: false, deltaX: 0, deltaY: 50 }))).toBeNull();
	});
});

describe('panHorizontalWheel', () => {
	afterEach(() => {
		document.body.replaceChildren();
		delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
	});

	it('scrolls the horizontal scroller under the pointer with Shift+wheel', () => {
		const strip = scroller();
		document.body.append(strip);
		document.elementsFromPoint = () => [strip];

		const event = wheel({ shiftKey: true, deltaY: 50, clientX: 10, clientY: 10 });
		expect(panHorizontalWheel(event)).toBe(true);
		expect(strip.scrollLeft).toBe(50);
		expect(event.defaultPrevented).toBe(true);
	});

	it('leaves a vertical-only wheel alone without Shift', () => {
		const strip = scroller();
		document.body.append(strip);
		document.elementsFromPoint = () => [strip];

		const event = wheel({ deltaY: 50, clientX: 10, clientY: 10 });
		expect(panHorizontalWheel(event)).toBe(false);
		expect(strip.scrollLeft).toBe(0);
		expect(event.defaultPrevented).toBe(false);
	});

	it('finds a scroller from the event target without hit testing', () => {
		const strip = scroller();
		const badge = document.createElement('span');
		strip.append(badge);
		document.body.append(strip);

		expect(horizontalScrollerAt(0, 0, badge)).toBe(strip);

		const event = wheel({ shiftKey: true, deltaY: 20, clientX: 0, clientY: 0 });
		Object.defineProperty(event, 'target', { configurable: true, value: badge });
		expect(panHorizontalWheel(event)).toBe(true);
		expect(strip.scrollLeft).toBe(20);
	});
});

describe('installHorizontalWheel', () => {
	it('is idempotent per target and answers wheel on that target', () => {
		// Disconnected from document so the suite's window-level installer stays out of the way.
		const host = document.createElement('div');
		const strip = scroller();
		host.append(strip);

		const uninstall = installHorizontalWheel(host);
		const second = installHorizontalWheel(host);
		expect(second).toBeTypeOf('function');
		second();

		const event = wheel({ shiftKey: true, deltaY: 35, clientX: 0, clientY: 0 });
		strip.dispatchEvent(event);
		expect(strip.scrollLeft).toBe(35);

		uninstall();
		const after = wheel({ shiftKey: true, deltaY: 10, clientX: 0, clientY: 0 });
		strip.dispatchEvent(after);
		expect(strip.scrollLeft).toBe(35);
		expect(after.defaultPrevented).toBe(false);
	});
});
