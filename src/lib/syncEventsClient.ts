export type SyncNudgeListener = (seq?: number) => void;

export interface SyncStoreLike {
	readonly isLoggedIn: boolean;
	authorizedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export class SyncEventsClient {
	private abortController: AbortController | null = null;
	private active = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private backoffMs = 2_000;
	private readonly listeners = new Set<SyncNudgeListener>();
	private cleanupDomListeners: (() => void) | null = null;

	constructor(private readonly syncStore: SyncStoreLike) {
		if (typeof window !== 'undefined' && typeof document !== 'undefined') {
			const onVisibility = () => this.updateState();
			const onOnline = () => this.updateState();
			const onOffline = () => this.updateState();

			document.addEventListener('visibilitychange', onVisibility);
			window.addEventListener('online', onOnline);
			window.addEventListener('offline', onOffline);

			this.cleanupDomListeners = () => {
				document.removeEventListener('visibilitychange', onVisibility);
				window.removeEventListener('online', onOnline);
				window.removeEventListener('offline', onOffline);
			};
		}
	}

	subscribe(listener: SyncNudgeListener): () => void {
		this.listeners.add(listener);
		this.updateState();
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) {
				this.stop();
			}
		};
	}

	updateState(): void {
		const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
		const isVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
		const shouldConnect =
			this.listeners.size > 0 && this.syncStore.isLoggedIn && isVisible && isOnline;

		if (shouldConnect) {
			if (!this.active) {
				this.start();
			}
		} else {
			if (this.active) {
				this.stop();
			}
		}
	}

	start(): void {
		this.active = true;
		void this.connect();
	}

	stop(): void {
		this.active = false;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
		this.backoffMs = 2_000;
	}

	destroy(): void {
		this.stop();
		this.listeners.clear();
		if (this.cleanupDomListeners) {
			this.cleanupDomListeners();
			this.cleanupDomListeners = null;
		}
	}

	private async connect(): Promise<void> {
		if (!this.active || !this.syncStore.isLoggedIn) return;
		if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		try {
			const response = await this.syncStore.authorizedFetch('/api/sync/events', { signal });
			if (!response.ok || !response.body) {
				throw new Error(`SSE error: ${response.status}`);
			}
			this.backoffMs = 2_000;

			const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
			let buffer = '';

			while (!signal.aborted) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += value;
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (line.startsWith('data:')) {
						try {
							const payload = JSON.parse(line.slice(5).trim()) as { seq?: number };
							for (const listener of this.listeners) {
								listener(payload.seq);
							}
						} catch {
							/* malformed line */
						}
					}
				}
			}
		} catch {
			/* abort or network disruption */
		} finally {
			this.abortController = null;
			const isVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
			if (this.active && this.syncStore.isLoggedIn && isVisible) {
				this.scheduleReconnect();
			}
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer || !this.active) return;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.backoffMs = Math.min(this.backoffMs * 1.5, 30_000);
			void this.connect();
		}, this.backoffMs);
	}
}
