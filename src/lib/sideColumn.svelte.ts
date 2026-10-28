import type { Insets } from './appViewport.js';

export type SideColumn = 'left' | 'right' | null;

/** A side inset this deep is a status column, not a rounded corner. */
const COLUMN_MIN_PX = 60;

/**
 * The folded iPhone Duo's outer screen keeps its status bar down one side: a
 * portrait phone window with a deep inset at a side and none on top. The app
 * lays its navigation into that column. A landscape phone's side insets are a
 * notch, and a top inset means the bar is on top as usual.
 */
export function sideColumnOf(
	insets: Insets,
	width: number,
	height: number,
	onPhone: boolean
): SideColumn {
	if (!onPhone || width >= height || insets.top >= 20) return null;
	if (insets.right >= COLUMN_MIN_PX) return 'right';
	if (insets.left >= COLUMN_MIN_PX) return 'left';
	return null;
}

/** Which side the column is on, for components that move into it. */
export const sideColumn = $state<{ side: SideColumn }>({ side: null });

/** Publish the column for CSS (`html[data-side-column]`) and components alike. */
export function publishSideColumn(side: SideColumn): void {
	if (sideColumn.side !== side) sideColumn.side = side;
	const root = document.documentElement;
	if (side) root.dataset.sideColumn = side;
	else delete root.dataset.sideColumn;
}
