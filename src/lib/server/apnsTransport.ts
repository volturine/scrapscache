// Requests to Apple's push service from Node. Apple speaks only HTTP/2, which
// Node's `fetch` does not; the Workers build swaps in `cloudflare/apnsTransport`,
// where `fetch` does (see vite.config).
import { connect, type ClientHttp2Session } from 'node:http2';

export type AppleAnswer = { status: number; body: string };

export type ApplePost = (
	host: string,
	path: string,
	headers: Record<string, string>,
	body: string,
	timeoutMs: number
) => Promise<AppleAnswer>;

/**
 * Posts over one connection per host, kept open between sends: Apple asks its
 * providers to hold their connections, and reads a stream of short ones as an
 * attack. A connection that closed, was told to go away, failed or stopped
 * answering is left behind, and the next send opens another. `originOf` says
 * where a host is reached, which a test points at a server of its own.
 */
export function http2Poster(originOf: (host: string) => string): ApplePost {
	const sessions = new Map<string, ClientHttp2Session>();

	function sessionTo(host: string): ClientHttp2Session {
		const open = sessions.get(host);
		if (open && !open.closed && !open.destroyed) return open;
		const session = connect(originOf(host));
		const retire = () => {
			if (sessions.get(host) === session) sessions.delete(host);
		};
		session.on('close', retire);
		// The requests under way finish on it; new ones get a new connection.
		session.on('goaway', () => {
			retire();
			session.close();
		});
		// Its requests fail with it. Unheard, the error would be thrown instead.
		session.on('error', retire);
		// An idle connection must not keep the server from stopping.
		session.unref();
		sessions.set(host, session);
		return session;
	}

	return (host, path, headers, body, timeoutMs) =>
		new Promise((resolve, reject) => {
			const session = sessionTo(host);
			const request = session.request({ ':method': 'POST', ':path': path, ...headers });
			let status = 0;
			let text = '';
			request.setEncoding('utf8');
			request.setTimeout(timeoutMs, () => {
				// A connection that went silent is not one to send the next push over.
				session.destroy();
				reject(new Error('Apple did not answer in time'));
			});
			request.on('response', (answered) => {
				status = Number(answered[':status']);
			});
			request.on('data', (chunk: string) => {
				text += chunk;
			});
			request.on('end', () => resolve({ status, body: text }));
			request.on('error', reject);
			request.end(body);
		});
}

export const postToApple: ApplePost = http2Poster((host) => `https://${host}`);
