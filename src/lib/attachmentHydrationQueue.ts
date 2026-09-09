/**
 * Small shared queue for attachment reads triggered by visible note cards.
 * It prevents a route from starting every Blob-to-data-URL conversion at once.
 */
export class AttachmentHydrationQueue {
	private pending: string[] = [];
	private queued = new Set<string>();
	private running = 0;

	constructor(
		private readonly hydrate: (noteId: string) => Promise<void>,
		private readonly concurrency = 2
	) {}

	clear(): void {
		this.pending = [];
		this.queued.clear();
	}

	enqueue(noteId: string): void {
		if (!noteId || this.queued.has(noteId)) return;
		this.queued.add(noteId);
		this.pending.push(noteId);
		this.drain();
	}

	private drain(): void {
		while (this.running < this.concurrency && this.pending.length > 0) {
			const noteId = this.pending.shift();
			if (!noteId) continue;
			this.running++;
			void this.hydrate(noteId).finally(() => {
				this.running--;
				this.queued.delete(noteId);
				this.drain();
			});
		}
	}
}
