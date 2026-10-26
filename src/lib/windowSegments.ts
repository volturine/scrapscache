/** One screen of a dual-screen window, in layout-viewport coordinates. */
export type SegmentRect = { x: number; y: number; width: number; height: number };

export type SpanKind = 'single' | 'horizontal' | 'vertical';

export type SpanLayout = {
	kind: SpanKind;
	/** Width of the first screen. Zero when the window is a single segment. */
	screenWidth: number;
	foldX: number;
	foldY: number;
	foldW: number;
	foldH: number;
};

type SegmentLike = {
	x?: number;
	y?: number;
	left?: number;
	top?: number;
	width: number;
	height: number;
};

/** Folded Surface Duo's side status column, when the browser reports no safe-area inset. */
export const DUO_FOLDED_GUTTER_PX = 84;

export const SPAN_STYLE_VARS = [
	'--app-screen-width',
	'--app-column-width',
	'--app-column-gap',
	'--app-fold-x',
	'--app-fold-y',
	'--app-fold-w',
	'--app-fold-h',
	'--app-tabbar-height'
] as const;

export type SpanStyleVar = (typeof SPAN_STYLE_VARS)[number];

const SINGLE: SpanLayout = {
	kind: 'single',
	screenWidth: 0,
	foldX: 0,
	foldY: 0,
	foldW: 0,
	foldH: 0
};

export function isSurfaceDuo(userAgent: string, model = ''): boolean {
	return /Surface Duo/i.test(userAgent) || /Surface Duo/i.test(model);
}

/**
 * Folded portrait keeps the hinge and its status column on one side. Angle 0 is
 * the left panel facing up, so the gutter is on the right; 180 flips it.
 * A reported inset already covering that side is kept. Spanned and landscape
 * windows get nothing here: the hinge is a segment gap, and landscape status is on top.
 */
export function duoFoldedSideInset(input: {
	duo: boolean;
	width: number;
	height: number;
	angle: number;
	safeLeft: number;
	safeRight: number;
	spanned: boolean;
}): { left: number; right: number } {
	const left = Math.max(0, input.safeLeft);
	const right = Math.max(0, input.safeRight);
	if (!input.duo || input.spanned || input.width <= 0 || input.height <= input.width) {
		return { left, right };
	}
	if (input.angle === 180) return { left: Math.max(left, DUO_FOLDED_GUTTER_PX), right };
	return { left, right: Math.max(right, DUO_FOLDED_GUTTER_PX) };
}

function segmentRect(segment: SegmentLike): SegmentRect | null {
	const width = segment.width;
	const height = segment.height;
	if (!(width > 0) || !(height > 0)) return null;
	return {
		x: segment.x ?? segment.left ?? 0,
		y: segment.y ?? segment.top ?? 0,
		width,
		height
	};
}

/** The first source that describes two real screens wins. */
export function segmentsFrom(
	...lists: Array<ArrayLike<SegmentLike> | null | undefined>
): SegmentRect[] {
	for (const list of lists) {
		if (!list) continue;
		const parsed: SegmentRect[] = [];
		for (let index = 0; index < list.length; index += 1) {
			const rect = segmentRect(list[index]);
			if (rect) parsed.push(rect);
		}
		if (parsed.length >= 2) return parsed;
	}
	return [];
}

export function readViewportSegments(): SegmentRect[] {
	if (typeof window === 'undefined') return [];
	const win = window as Window & {
		viewport?: { segments?: ArrayLike<SegmentLike> };
		getWindowSegments?: () => ArrayLike<SegmentLike>;
	};
	const visual = window.visualViewport as
		(VisualViewport & { segments?: ArrayLike<SegmentLike> }) | null;
	return segmentsFrom(win.viewport?.segments, visual?.segments, win.getWindowSegments?.());
}

/**
 * Two segments side by side (a vertical hinge, including a seamless join) are a
 * horizontal span. Anything else with two segments is stacked, a horizontal hinge.
 */
export function layoutFromSegments(
	segments: SegmentRect[],
	viewportWidth: number,
	viewportHeight: number
): SpanLayout {
	if (segments.length < 2 || viewportWidth <= 0 || viewportHeight <= 0) return SINGLE;
	const byX = [...segments].sort((a, b) => a.x - b.x || a.y - b.y);
	const left = byX[0];
	const right = byX[1];
	const gapX = right.x - (left.x + left.width);
	const overlapY =
		Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
	if (gapX >= -1 && overlapY > 0) {
		return {
			kind: 'horizontal',
			screenWidth: left.width,
			foldX: left.x + left.width,
			foldY: 0,
			foldW: Math.max(0, gapX),
			foldH: viewportHeight
		};
	}
	const byY = [...segments].sort((a, b) => a.y - b.y || a.x - b.x);
	const top = byY[0];
	const bottom = byY[1];
	const gapY = bottom.y - (top.y + top.height);
	return {
		kind: 'vertical',
		screenWidth: Math.max(top.width, bottom.width),
		foldX: 0,
		foldY: top.y + top.height,
		foldW: viewportWidth,
		foldH: Math.max(0, gapY)
	};
}

function px(value: number): string {
	return `${Math.round(value * 100) / 100}px`;
}

/**
 * Inline variables for a span. A single window returns none, so the stylesheet
 * env() defaults stay in force. Horizontal columns are one screen wide and the
 * track gap is the hinge; the left inset is already outside the frame, so the
 * first column ends on the hinge instead of running under it.
 */
export function spanStyle(
	layout: SpanLayout,
	leftInset: number
): { kind: SpanKind; vars: Partial<Record<SpanStyleVar, string>> } {
	if (layout.kind === 'single') return { kind: 'single', vars: {} };
	const vars: Partial<Record<SpanStyleVar, string>> = {
		'--app-fold-x': px(layout.foldX),
		'--app-fold-y': px(layout.foldY),
		'--app-fold-w': px(layout.foldW),
		'--app-fold-h': px(layout.foldH)
	};
	if (layout.kind === 'horizontal') {
		const screen = Math.max(0, layout.foldX - Math.max(0, leftInset));
		vars['--app-screen-width'] = px(screen);
		vars['--app-column-width'] = px(screen);
		vars['--app-column-gap'] = px(layout.foldW);
		vars['--app-tabbar-height'] = '3.5rem';
	}
	return { kind: layout.kind, vars };
}
