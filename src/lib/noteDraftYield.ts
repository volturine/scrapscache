/** The open note drops its unsaved draft so an undo can show the stored copy. */
let yieldDraft: ((id: string) => void) | null = null;

export function setNoteDraftYield(yieldToStore: (id: string) => void): () => void {
	yieldDraft = yieldToStore;
	return () => {
		if (yieldDraft === yieldToStore) yieldDraft = null;
	};
}

export function yieldNoteDraft(id: string): void {
	yieldDraft?.(id);
}
