import { openSyncEvents } from '#lib/syncEventsTransport.js';
import { uid } from '#lib/model/index.js';
import { backoffDelay, reconnectBackoff, wait } from '#lib/syncRetry.js';

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

export class SyncEventsClient {
	private active = false;
	/** Aborts the open connection and any pending reconnect wait. */
	private connection: AbortController | null = null;
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
		const connection = new AbortController();
		this.connection = connection;
		void this.stayConnected(connection.signal);
	}

	stop(): void {
		this.active = false;
		this.connection?.abort();
		this.connection = null;
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

	private wanted(): boolean {
		const isVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
		return this.active && this.syncStore.isLoggedIn && isVisible;
	}

	/**
	 * One connection, for as long as it lasts: SSE on Node, a WebSocket on Workers.
	 * True when it opened; one that never did makes the next attempt back off further.
	 */
	private async session(signal: AbortSignal): Promise<boolean> {
		let opened = false;
		try {
			await openSyncEvents({
				store: this.syncStore,
				clientId: this.clientId,
				signal,
				onOpen: () => {
					if (signal.aborted) return false;
					opened = true;
					// Nothing signalled changes made while no connection was open
					// (a dropped socket, an expired session, a hidden tab), so
					// every connection starts by pulling once.
					for (const listener of this.listeners) listener();
					return true;
				},
				onSeq: (seq) => {
					for (const listener of this.listeners) listener(seq);
				}
			});
		} catch {
			// Abort or network disruption: either way the connection is over.
		}
		return opened;
	}

	/**
	 * Stay connected while wanted. Connections that fail to open back off from
	 * 2 to 30 seconds; one that opened and later dropped starts that over after a
	 * single short pause, so a relay restart is not met by every device at once.
	 */
	private async stayConnected(signal: AbortSignal): Promise<void> {
		let failures = 0;
		while (!signal.aborted && this.wanted()) {
			const opened = await this.session(signal);
			if (signal.aborted || !this.wanted()) return;
			failures = opened ? 0 : failures + 1;
			await wait(
				opened ? 1_600 + Math.random() * 800 : backoffDelay(reconnectBackoff, failures - 1),
				signal
			);
		}
	}
}
