import { openSyncEvents } from '#lib/syncEventsTransport.js';
import { uid } from '#lib/model/index.js';
import { Duration } from 'effect';

export type SyncNudgeListener = (seq?: number) => void;

export interface SyncStoreLike {
	readonly isLoggedIn: boolean;
	authorizedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
	/**
	 * An access token for a connection that cannot carry the `Authorization`
	 * header. `refused` drops it, so the next connection signs in again.
	 */
	connectionToken?(): Promise<{ token: string; refused(): void }>;
}

/** One live connection, whichever transport carries it. */
export type SyncEventsConnection = {
	store: SyncStoreLike;
	clientId: string;
	signal: AbortSignal;
	/** The connection is open. False when it is no longer wanted and should close. */
	onOpen(): boolean;
	onSeq(seq?: number): void;
};

const INITIAL_BACKOFF_MS = Duration.toMillis(Duration.seconds(2));
const MAX_BACKOFF_MS = Duration.toMillis(Duration.seconds(30));

export function computeNextReconnectBackoff(currentMs: number): number {
	const multiplied = Duration.millis(Math.round(currentMs * 1.5));
	return Duration.toMillis(Duration.min(multiplied, Duration.millis(MAX_BACKOFF_MS)));
}

export class SyncEventsClient {
	private abortController: AbortController | null = null;
	private active = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private backoffMs = INITIAL_BACKOFF_MS;
	private connectionGeneration = 0;
	private readonly listeners = new Set<SyncNudgeListener>();
	private cleanupDomListeners: (() => void) | null = null;
	readonly clientId: string;

	constructor(
		private readonly syncStore: SyncStoreLike,
		clientId?: string
	) {
		this.clientId = clientId ?? uid();

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
		if (this.active) return;
		this.active = true;
		this.beginConnection();
	}

	stop(): void {
		this.active = false;
		this.connectionGeneration += 1;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
		this.backoffMs = INITIAL_BACKOFF_MS;
	}

	accountChanged(): void {
		if (this.active) this.stop();
		this.updateState();
	}

	destroy(): void {
		this.stop();
		this.listeners.clear();
		if (this.cleanupDomListeners) {
			this.cleanupDomListeners();
			this.cleanupDomListeners = null;
		}
	}

	private beginConnection(): void {
		const generation = ++this.connectionGeneration;
		void this.connect(generation);
	}

	private async connect(generation: number): Promise<void> {
		if (!this.active || !this.syncStore.isLoggedIn) return;
		if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

		const controller = new AbortController();
		this.abortController = controller;
		const signal = controller.signal;

		try {
			// Resolves when the connection ends; SSE on Node, a WebSocket on Workers.
			await openSyncEvents({
				store: this.syncStore,
				clientId: this.clientId,
				signal,
				onOpen: () => {
					if (signal.aborted || generation !== this.connectionGeneration) return false;
					this.backoffMs = INITIAL_BACKOFF_MS;
					return true;
				},
				onSeq: (seq) => {
					for (const listener of this.listeners) listener(seq);
				}
			});
		} catch {
			/* abort or network disruption */
		} finally {
			if (generation !== this.connectionGeneration) return;
			if (this.abortController === controller) this.abortController = null;
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
			this.backoffMs = computeNextReconnectBackoff(this.backoffMs);
			this.beginConnection();
		}, this.backoffMs);
	}
}
