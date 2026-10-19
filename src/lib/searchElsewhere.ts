import { notesStore } from '#lib/stores/notes.svelte.js';

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
	notes: 'Archived and deleted notes are not searched here.',
	label: 'Only notes with this label are searched here.',
	archive: 'Only archived notes are searched here.',
	trash: 'Only deleted notes are searched here.'
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

/**
 * The other places where `query` finds notes, for a view where it found none.
 * A label view searches only some active notes, so Notes counts as elsewhere.
 */
export function placesWithMatches(here: SearchedView, query: string): SearchPlace[] {
	const pools = {
		notes: notesStore.activeNotes,
		archive: notesStore.archivedNotes,
		trash: notesStore.trashedNotes
	};
	return SEARCH_PLACES.filter(
		(place) => place !== here && notesStore.search(query, pools[place]).length > 0
	);
}

function list(names: string[], last: 'and' | 'or'): string {
	return names.length < 2
		? names.join('')
		: `${names.slice(0, -1).join(', ')} ${last} ${names.at(-1)}`;
}

/** What a view says when its search finds nothing: the query, the view's scope, where to look. */
export function noMatchCopy(
	here: SearchedView,
	query: string,
	places: SearchPlace[]
): { title: string; description: string; announcement: string } {
	const title = `No notes match “${shownQuery(query)}”`;
	const others = SEARCH_PLACES.filter((place) => place !== here).map((place) => PLACE_NAMES[place]);
	const description = places.length
		? SCOPE[here]
		: `${list(others, 'and')} have no matches either.`;
	const next = places.length
		? `Look in ${list(
				places.map((place) => PLACE_NAMES[place]),
				'or'
			)}.`
		: description;
	return { title, description, announcement: `${title}. ${next}` };
}
