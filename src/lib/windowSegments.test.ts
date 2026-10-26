import { describe, expect, it } from 'vitest';
import {
	DUO_FOLDED_GUTTER_PX,
	duoFoldedSideInset,
	isSurfaceDuo,
	layoutFromSegments,
	segmentsFrom,
	spanStyle,
	type SegmentRect
} from './windowSegments';

const sideBySide: SegmentRect[] = [
	{ x: 0, y: 0, width: 540, height: 720 },
	{ x: 574, y: 0, width: 540, height: 720 }
];

const stacked: SegmentRect[] = [
	{ x: 0, y: 0, width: 720, height: 540 },
	{ x: 0, y: 574, width: 720, height: 540 }
];

describe('isSurfaceDuo', () => {
	it('matches the user agent or the high-entropy model', () => {
		expect(isSurfaceDuo('Mozilla/5.0 (Linux; Android 12; Surface Duo 2)')).toBe(true);
		expect(isSurfaceDuo('Mozilla/5.0', 'Surface Duo')).toBe(true);
		expect(isSurfaceDuo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(false);
	});
});

describe('duoFoldedSideInset', () => {
	const portrait = {
		duo: true,
		width: 540,
		height: 720,
		spanned: false,
		safeLeft: 0,
		safeRight: 0
	};

	it('reserves the right side when the left panel is facing up', () => {
		expect(duoFoldedSideInset({ ...portrait, angle: 0 })).toEqual({
			left: 0,
			right: DUO_FOLDED_GUTTER_PX
		});
	});

	it('reserves the left side when the device is flipped', () => {
		expect(duoFoldedSideInset({ ...portrait, angle: 180 })).toEqual({
			left: DUO_FOLDED_GUTTER_PX,
			right: 0
		});
	});

	it('keeps a larger inset the browser already reported', () => {
		expect(duoFoldedSideInset({ ...portrait, angle: 0, safeRight: 100 })).toEqual({
			left: 0,
			right: 100
		});
	});

	it('adds nothing on landscape, when spanned, or on any other device', () => {
		expect(duoFoldedSideInset({ ...portrait, angle: 0, height: 400, width: 720 })).toEqual({
			left: 0,
			right: 0
		});
		expect(duoFoldedSideInset({ ...portrait, angle: 0, spanned: true })).toEqual({
			left: 0,
			right: 0
		});
		expect(duoFoldedSideInset({ ...portrait, angle: 0, duo: false, safeLeft: 8 })).toEqual({
			left: 8,
			right: 0
		});
	});
});

describe('segmentsFrom', () => {
	it('uses the first source that has two screens and skips empty ones', () => {
		const visual = [{ x: 0, y: 0, width: 10, height: 10 }];
		expect(segmentsFrom(undefined, visual, sideBySide)).toEqual(sideBySide);
	});

	it('reads left and top when x and y are absent, and drops non-positive segments', () => {
		expect(
			segmentsFrom([
				{ left: 0, top: 0, width: 100, height: 50 },
				{ left: 110, top: 0, width: 0, height: 50 },
				{ left: 110, top: 0, width: 100, height: 50 }
			])
		).toEqual([
			{ x: 0, y: 0, width: 100, height: 50 },
			{ x: 110, y: 0, width: 100, height: 50 }
		]);
	});
});

describe('layoutFromSegments', () => {
	it('is a single window without two segments or a viewport', () => {
		expect(layoutFromSegments(sideBySide.slice(0, 1), 540, 720).kind).toBe('single');
		expect(layoutFromSegments(sideBySide, 0, 720).kind).toBe('single');
	});

	it('places a vertical hinge between side-by-side screens, including a seamless join', () => {
		expect(layoutFromSegments(sideBySide, 1114, 720)).toEqual({
			kind: 'horizontal',
			screenWidth: 540,
			foldX: 540,
			foldY: 0,
			foldW: 34,
			foldH: 720
		});
		const abutting: SegmentRect[] = [
			{ x: 0, y: 0, width: 540, height: 720 },
			{ x: 540, y: 0, width: 540, height: 720 }
		];
		expect(layoutFromSegments(abutting, 1080, 720).foldW).toBe(0);
		expect(layoutFromSegments(abutting, 1080, 720).kind).toBe('horizontal');
	});

	it('places a horizontal hinge between stacked screens', () => {
		expect(layoutFromSegments(stacked, 720, 1114)).toEqual({
			kind: 'vertical',
			screenWidth: 720,
			foldX: 0,
			foldY: 540,
			foldW: 720,
			foldH: 34
		});
	});
});

describe('spanStyle', () => {
	it('publishes nothing for a single window', () => {
		expect(spanStyle(layoutFromSegments([], 390, 844), 0)).toEqual({ kind: 'single', vars: {} });
	});

	it('sizes one column to the screen left of the hinge, after the left inset', () => {
		const style = spanStyle(layoutFromSegments(sideBySide, 1114, 720), 12);
		expect(style.kind).toBe('horizontal');
		expect(style.vars['--app-screen-width']).toBe('528px');
		expect(style.vars['--app-column-width']).toBe('528px');
		expect(style.vars['--app-column-gap']).toBe('34px');
		expect(style.vars['--app-fold-x']).toBe('540px');
		expect(style.vars['--app-fold-h']).toBe('720px');
		expect(style.vars['--app-tabbar-height']).toBe('3.5rem');
	});

	it('publishes a horizontal hinge without resizing the columns', () => {
		const style = spanStyle(layoutFromSegments(stacked, 720, 1114), 0);
		expect(style.kind).toBe('vertical');
		expect(style.vars['--app-fold-y']).toBe('540px');
		expect(style.vars['--app-fold-h']).toBe('34px');
		expect(style.vars['--app-column-width']).toBeUndefined();
		expect(style.vars['--app-tabbar-height']).toBeUndefined();
	});
});
