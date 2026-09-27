/** A window's id, as the client sends it to be left out of its own announcements. */
export function validReminderClientId(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value);
}

/** One account's reminder-only notifications. No ciphertext, cursor or note data travels here. */
export class ReminderEventChannel {
	private listeners = new Map<(message: string) => void, string | undefined>();
	constructor(private readonly onEmpty: () => void = () => undefined) {}
	/** Tell every window of the account, except the one whose upload this announces. */
	notify(senderClientId?: string): void {
		for (const [send, clientId] of this.listeners) {
			if (senderClientId === undefined || clientId !== senderClientId) send('data: {}\n\n');
		}
	}
	stream(signal?: AbortSignal, clientId?: string): Response {
		if (this.listeners.size >= 64)
			return new Response('Too many reminder streams', {
				status: 429,
				headers: { 'retry-after': '5' }
			});
		const encoder = new TextEncoder();
		let cleanup = () => undefined as void;
		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				let closed = false;
				let heartbeat: ReturnType<typeof setInterval> | undefined;
				cleanup = () => {
					if (closed) return;
					closed = true;
					if (heartbeat !== undefined) clearInterval(heartbeat);
					signal?.removeEventListener('abort', cleanup);
					this.listeners.delete(send);
					try {
						controller.close();
					} catch {
						/* already cancelled */
					}
					if (!this.listeners.size) this.onEmpty();
				};
				const send = (message: string) => {
					if (closed) return;
					// Every message only says "look again"; while one is still queued for a
					// slow reader, another adds nothing. A gone reader cancels the stream.
					if ((controller.desiredSize ?? 0) <= 0) return;
					try {
						controller.enqueue(encoder.encode(message));
					} catch {
						cleanup();
					}
				};
				this.listeners.set(send, clientId);
				signal?.addEventListener('abort', cleanup, { once: true });
				if (signal?.aborted) {
					cleanup();
					return;
				}
				send(': connected\n\n');
				heartbeat = setInterval(() => send(': ping\n\n'), 25_000);
			},
			cancel: () => cleanup()
		});
		return new Response(stream, {
			headers: {
				'content-type': 'text/event-stream',
				'cache-control': 'no-cache, no-transform',
				'x-accel-buffering': 'no'
			}
		});
	}
}
