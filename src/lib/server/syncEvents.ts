export type SyncEventListener = (seq: number, senderClientId?: string) => void;

type Subscription = { listener: SyncEventListener; end?: () => void };

class SyncEventEmitter {
	private readonly listeners = new Map<string, Set<Subscription>>();

	notify(accountId: string, seq: number, senderClientId?: string): void {
		const set = this.listeners.get(accountId);
		if (!set) return;
		for (const { listener } of set) {
			try {
				listener(seq, senderClientId);
			} catch {
				/* ignore listener error */
			}
		}
	}

	/** `end` runs when the account's sessions are revoked, so a live stream can close. */
	subscribe(accountId: string, listener: SyncEventListener, end?: () => void): () => void {
		let set = this.listeners.get(accountId);
		if (!set) {
			set = new Set();
			this.listeners.set(accountId, set);
		}
		const subscription: Subscription = { listener, end };
		set.add(subscription);
		return () => {
			set.delete(subscription);
			if (set.size === 0 && this.listeners.get(accountId) === set) this.listeners.delete(accountId);
		};
	}

	/** Drop every subscriber of an account, ending each one's stream. */
	endAccount(accountId: string): void {
		const set = this.listeners.get(accountId);
		if (!set) return;
		this.listeners.delete(accountId);
		for (const { end } of set) {
			try {
				end?.();
			} catch {
				/* ignore a stream that is already closing */
			}
		}
	}

	listenerCount(accountId: string): number {
		return this.listeners.get(accountId)?.size ?? 0;
	}

	clear(): void {
		this.listeners.clear();
	}
}

export const syncEventEmitter = new SyncEventEmitter();
