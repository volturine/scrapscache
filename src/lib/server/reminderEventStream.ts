/** One account's reminder-only notifications. No ciphertext, cursor or note data travels here. */
export class ReminderEventChannel {
	private listeners = new Set<(message: string) => void>();
	constructor(private readonly onEmpty: () => void = () => undefined) {}
	notify(): void {
		for (const send of this.listeners) send('data: {}\n\n');
	}
	stream(signal?: AbortSignal): Response {
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
					// A client that stopped reading reconnects and catches up from its durable cursor.
					if ((controller.desiredSize ?? 0) <= 0) {
						cleanup();
						return;
					}
					try {
						controller.enqueue(encoder.encode(message));
					} catch {
						cleanup();
					}
				};
				this.listeners.add(send);
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
