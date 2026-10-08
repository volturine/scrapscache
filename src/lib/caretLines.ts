/** A caret position in a row's text and where the browser draws it. */
export type CaretStop = { offset: number; x: number; top: number; bottom: number };

/**
 * Whether two caret stops sit on the same visual line: each one's top is above the
 * other's middle, so a slightly taller inline box such as inline code still counts.
 */
export function sameVisualLine(a: CaretStop, b: CaretStop): boolean {
	return a.top < (b.top + b.bottom) / 2 && b.top < (a.top + a.bottom) / 2;
}

/** The offset on a visual line drawn nearest `x`; the earlier one wins a tie. */
export function offsetNearestX(visualLine: CaretStop[], x: number): number {
	let best = visualLine[0];
	for (const stop of visualLine) {
		if (Math.abs(stop.x - x) < Math.abs(best.x - x)) best = stop;
	}
	return best.offset;
}
