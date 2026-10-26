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
};

class ComposerStore {
	/** The note the bar is writing, while it is open. */
	draftId = $state<string | null>(null);
	private host: ((seed?: ComposerSeed) => void) | null = null;

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
