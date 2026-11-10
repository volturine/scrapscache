// Controls pressed while the software keyboard is up, over a note being typed.
//
// iOS answers a tap outside the editing host with synthetic mouse events that
// blur the body and drop the keyboard; the sheet then grows and whatever sat
// at its bottom slides away under the finger before the click arrives, so it
// lands on nothing. Preventing the pointer default is enough on Android but
// not on iOS: only a cancelled touchend stops those events, and the click
// with them, so the control is pressed here on the release instead.

import { isKeyboardField } from './appViewport';

const TOUCH_TAP_SLOP = 8;

/** What a release presses: buttons, and the labels that carry a checkbox. */
const PRESSABLE = 'button, label, [data-scope="checkbox"]';

function pressableFrom(target: EventTarget | null): HTMLElement | null {
	const element = target instanceof Element ? target.closest(PRESSABLE) : null;
	return element instanceof HTMLElement ? element : null;
}

/**
 * `{@attach pressOnTouchRelease}` on a container: a touch on one of its
 * controls keeps the field focused and presses the control on release. A
 * release that slid off the control, or a touch that scrolled, presses nothing.
 */
export function pressOnTouchRelease(node: HTMLElement): () => void {
	const keepFocus = (event: PointerEvent) => {
		if (event.pointerType !== 'touch' || !pressableFrom(event.target)) return;
		event.preventDefault();
	};
	const press = (event: TouchEvent) => {
		// A container inside this one has pressed it already.
		if (event.defaultPrevented) return;
		if (!event.cancelable || event.changedTouches.length !== 1) return;
		const control = pressableFrom(event.target);
		if (!control) return;
		const touch = event.changedTouches[0];
		const box = control.getBoundingClientRect();
		if (
			touch.clientX < box.left - TOUCH_TAP_SLOP ||
			touch.clientX > box.right + TOUCH_TAP_SLOP ||
			touch.clientY < box.top - TOUCH_TAP_SLOP ||
			touch.clientY > box.bottom + TOUCH_TAP_SLOP
		) {
			return;
		}
		event.preventDefault();
		const field = document.activeElement;
		control.click();
		// A control that takes focus for itself (Safari toggles do) would drop the
		// keyboard; still inside the touch, the field can take it back and keep it.
		if (
			field instanceof HTMLElement &&
			field.isConnected &&
			isKeyboardField(field) &&
			document.activeElement !== field &&
			!isKeyboardField(document.activeElement)
		) {
			field.focus({ preventScroll: true });
		}
	};
	node.addEventListener('pointerdown', keepFocus);
	node.addEventListener('touchend', press);
	return () => {
		node.removeEventListener('pointerdown', keepFocus);
		node.removeEventListener('touchend', press);
	};
}
