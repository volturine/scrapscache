export type SyncEventListener = (seq: number, senderClientId?: string) => void;

class SyncEventEmitter {
	private readonly listeners = new Map<string, Set<SyncEventListener>>();

	notify(accountId: string, seq: number, senderClientId?: string): void {
		const set = this.listeners.get(accountId);
		if (!set) return;
		for (const listener of set) {
			try {
				listener(seq, senderClientId);
			} catch {
				/* ignore listener error */
			}
		}
	}

	subscribe(accountId: string, listener: SyncEventListener): () => void {
		let set = this.listeners.get(accountId);
		if (!set) {
			set = new Set();
			this.listeners.set(accountId, set);
		}
		set.add(listener);
		return () => {
			set.delete(listener);
			if (set.size === 0) this.listeners.delete(accountId);
		};
	}

	listenerCount(accountId: string): number {
		return this.listeners.get(accountId)?.size ?? 0;
	}

	clear(): void {
		this.listeners.clear();
	}
}

export const syncEventEmitter = new SyncEventEmitter();
