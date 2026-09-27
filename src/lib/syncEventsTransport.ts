import type { SyncEventsConnection } from '$lib/syncEventsClient';

/** Server-sent events, as the Node relay serves them. Resolves when the stream ends. */
export async function openSyncEvents(connection: SyncEventsConnection): Promise<void> {
	const { store, clientId, signal } = connection;
	const url = `/api/sync/events?clientId=${encodeURIComponent(clientId)}`;
	const response = await store.authorizedFetch(url, { signal });
	if (!response.ok || !response.body) {
		throw new Error(`SSE error: ${response.status}`);
	}
	if (!connection.onOpen()) {
		await response.body.cancel().catch(() => undefined);
		return;
	}

	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	const cancel = () => {
		void reader.cancel().catch(() => undefined);
	};
	signal.addEventListener('abort', cancel, { once: true });
	let buffer = '';
	try {
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
						connection.onSeq(payload.seq);
					} catch {
						/* malformed line */
					}
				}
			}
		}
	} finally {
		signal.removeEventListener('abort', cancel);
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}
