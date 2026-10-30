import type { Insets } from './appViewport.js';

export type SideColumn = 'left' | 'right' | null;

/** A side inset this deep is a status column, not a rounded corner or a notch. */
const COLUMN_MIN_PX = 60;

/**
 * iPhone Duo keeps its status bar in a column down one side: folded or open,
 * portrait or landscape. The other side stays shallow. A landscape notch is
 * deep on both sides, so it is not a column. A top inset is not the bar — the
 * bar is in the column, and treating the top inset as a status bar leaves an
 * empty band above the note.
 *
 * `width`, `height` and `onPhone` stay in the signature so callers can pass the
 * frame they measured; the column is read from the insets alone.
 */
export function sideColumnOf(
	insets: Insets,
	_width: number,
	_height: number,
	_onPhone: boolean
): SideColumn {
	if (insets.right >= COLUMN_MIN_PX && insets.left < COLUMN_MIN_PX) return 'right';
	if (insets.left >= COLUMN_MIN_PX && insets.right < COLUMN_MIN_PX) return 'left';
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
