// The "Take a note…" bar at the top of a feed. The views it is on leave the note
// it is writing out of the feed until it is put away, so what is typed does not
// also grow as a card underneath.

export type ComposerSeed = {
	title?: string;
	body?: string;
	/** Start as a checklist. */
	checklist?: boolean;
	/** Open straight into attaching a photo or drawing. */
	attach?: 'photo' | 'drawing';
	/** Files to attach, from a paste or a drop. */
	files?: File[];
};

/** The draft's id outlives the window: a killed app finds it here at the next load. */
const DRAFT_KEY = 'scrapscache-composer-draft';

class ComposerStore {
	#draftId = $state<string | null>(null);
	private host: ((seed?: ComposerSeed) => void) | null = null;

	/** The note the bar is writing, while it is open. */
	get draftId(): string | null {
		return this.#draftId;
	}

	set draftId(id: string | null) {
		this.#draftId = id;
		try {
			if (id) localStorage.setItem(DRAFT_KEY, id);
			else localStorage.removeItem(DRAFT_KEY);
		} catch {
			// No storage: the draft is only as safe as the window.
		}
	}

	/**
	 * The draft a window was writing when it went away without putting the bar
	 * away (the app killed, the tab closed): a note the label picker or a colour
	 * made before anything was typed. The notes store drops it at load if it is
	 * still empty, and keeps it if something was written after all.
	 */
	abandonedDraft(): string | null {
		try {
			const id = localStorage.getItem(DRAFT_KEY);
			return id && id !== this.#draftId ? id : null;
		} catch {
			return null;
		}
	}

	/** The abandoned draft has been dealt with; another workspace's load need not look. */
	forgetAbandonedDraft(id: string): void {
		try {
			if (localStorage.getItem(DRAFT_KEY) === id) localStorage.removeItem(DRAFT_KEY);
		} catch {
			// Nothing stored, nothing to forget.
		}
	}

	/** A mounted bar offers itself; the handle given back takes the offer away. */
	attach(host: (seed?: ComposerSeed) => void): () => void {
		this.host = host;
		return () => {
			if (this.host === host) this.host = null;
		};
	}

	/** Open the bar with what was given; false when no view has one. */
	open(seed?: ComposerSeed): boolean {
		if (!this.host) return false;
		this.host(seed);
		return true;
	}
}

export const composerStore = new ComposerStore();
