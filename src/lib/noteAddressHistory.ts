/** How the open note should sit in the browser history. */

export interface NoteAddressHistoryInput {
	/** `pathname + search + hash` of the address bar. */
	current: string;
	/** Address with the note that should be open, or with the note removed. */
	next: string;
	/** `next` with the note removed, keeping the view path. */
	closed: string;
	open: boolean;
	/**
	 * The history entry pushed for the open note. Back pops it and closes the
	 * note. Null when the current entry is the page itself.
	 */
	covering: string | null;
}

export interface NoteAddressHistoryUpdate {
	covering: string | null;
	/** Replace the current entry. Done before `push` so back lands on a page with no note. */
	replace?: string;
	/** Push a new entry for the open note. */
	push?: string;
	/** Pop the covering entry. The browser restores the page underneath. */
	back: boolean;
}

export function noteAddressHistory(input: NoteAddressHistoryInput): NoteAddressHistoryUpdate {
	if (input.open) {
		if (input.covering === null) {
			return {
				covering: input.next,
				replace: input.current === input.closed ? undefined : input.closed,
				push: input.next,
				back: false
			};
		}
		if (input.next !== input.current) {
			return { covering: input.next, replace: input.next, back: false };
		}
		return { covering: input.covering, back: false };
	}
	if (input.covering !== null && input.current === input.covering) {
		return { covering: null, back: true };
	}
	if (input.next !== input.current) {
		return { covering: null, replace: input.next, back: false };
	}
	return { covering: null, back: false };
}
