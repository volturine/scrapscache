// One body line as a list or preview names it: without the list, heading, quote or
// checklist marker that starts it. Every place that names a note by a line uses this.

/** A bullet (•, -, *, +), number, heading or quote marker, then a checkbox, each optional. */
const MARKER = /^\s*(?:[-*+•]\s+|\d+[.)]\s+|#{1,6}\s+|>\s*)?(?:\[[ xX]?\]\s*)?/;

export function plainLine(line: string): string {
	return line.replace(MARKER, '').trim();
}
