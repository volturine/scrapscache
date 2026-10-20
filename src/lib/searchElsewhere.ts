import { notesStore } from '#lib/stores/notes.svelte.js';
import { NO_FILTERS, type SearchFilters } from '#lib/search.js';

/** The views that each search a pool of their own: active, archived and deleted notes. */
export type SearchPlace = 'notes' | 'archive' | 'trash';

/** The views that say so when a search finds nothing in them. */
export type SearchedView = SearchPlace | 'label';

const SEARCH_PLACES: readonly SearchPlace[] = ['notes', 'archive', 'trash'];

export const PLACE_NAMES: Record<SearchPlace, string> = {
	notes: 'Notes',
	archive: 'Archive',
	trash: 'Trash'
};

const SCOPE: Record<SearchedView, string> = {
	notes: 'Searched Notes.',
	label: 'Searched only notes with this label.',
	archive: 'Searched Archive.',
	trash: 'Searched Trash.'
};

/** The longest query a message repeats; the field keeps the whole of it. */
const QUERY_SHOWN = 40;

/** A query as a message repeats it, cut by characters so an emoji stays whole. */
export function shownQuery(query: string): string {
	const characters = Array.from(query.trim());
	return characters.length > QUERY_SHOWN
		? `${characters.slice(0, QUERY_SHOWN - 1).join('')}…`
		: characters.join('');
}

/** How many notes `query` (and the chips) find in each other place, for a view that found none. */
export type Elsewhere = { place: SearchPlace; count: number };

/**
 * The other places and how many notes `query` finds in each, with the same chips.
 * A label view searches only some active notes, so Notes counts as elsewhere.
 */
export function matchesElsewhere(
	here: SearchedView,
	query: string,
	filters: SearchFilters = NO_FILTERS
): Elsewhere[] {
	const pools = {
		notes: notesStore.activeNotes,
		archive: notesStore.archivedNotes,
		trash: notesStore.trashedNotes
	};
	return SEARCH_PLACES.filter((place) => place !== here).map((place) => ({
		place,
		count: notesStore.search(query, pools[place], filters).length
	}));
}

function list(names: string[], last: 'and' | 'or'): string {
	return names.length < 2
		? names.join('')
		: `${names.slice(0, -1).join(', ')} ${last} ${names.at(-1)}`;
}

/** "1 match in Archive", then "3 in Trash", then "none in Notes": the found places first. */
function matchesIn({ place, count }: Elsewhere, first: boolean): string {
	const where = PLACE_NAMES[place];
	if (count === 0) return `none in ${where}`;
	if (!first) return `${count} in ${where}`;
	return count === 1 ? `1 match in ${where}` : `${count} matches in ${where}`;
}

/**
 * What a view says when its search finds nothing: the query, where it looked and what
 * the other places hold, and (with chips set) that the chips are part of the reason.
 */
export function noMatchCopy(
	here: SearchedView,
	query: string,
	elsewhere: Elsewhere[],
	filterCount = 0
): { title: string; description: string; announcement: string } {
	const title = filterCount
		? `No notes match “${shownQuery(query)}” with these filters`
		: `No notes match “${shownQuery(query)}”`;
	const found = elsewhere.filter((entry) => entry.count > 0);
	const ordered = [...found, ...elsewhere.filter((entry) => entry.count === 0)];
	const verb = found[0]?.count === 1 ? 'is' : 'are';
	const counts = found.length
		? `There ${verb} ${list(
				ordered.map((entry, index) => matchesIn(entry, index === 0)),
				'and'
			)}.`
		: `${list(
				elsewhere.map((entry) => PLACE_NAMES[entry.place]),
				'and'
			)} have no matches either.`;
	const description = `${SCOPE[here]} ${counts}`;
	const next = found.length
		? `Look in ${list(
				found.map((entry) => PLACE_NAMES[entry.place]),
				'or'
			)}.`
		: filterCount
			? 'Clear the filters to search everything.'
			: counts;
	return { title, description, announcement: `${title}. ${next}` };
}
