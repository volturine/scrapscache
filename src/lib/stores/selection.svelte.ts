/**
 * The notes picked in the feed, for one action on all of them. The selection is
 * this view only: changing view, or finishing an action, lets it go.
 */
class SelectionStore {
	ids = $state<string[]>([]);

	get active(): boolean {
		return this.ids.length > 0;
	}

	get count(): number {
		return this.ids.length;
	}

	has(id: string): boolean {
		return this.ids.includes(id);
	}

	toggle(id: string): void {
		this.ids = this.has(id) ? this.ids.filter((other) => other !== id) : [...this.ids, id];
	}

	clear(): void {
		if (this.ids.length) this.ids = [];
	}
}

export const selectionStore = new SelectionStore();
