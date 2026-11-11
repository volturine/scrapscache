// One request to Apple's push service from Node. Apple speaks only HTTP/2, which
// Node's `fetch` does not; the Workers build swaps in `cloudflare/apnsTransport`,
// where `fetch` does (see vite.config).
import { connect } from 'node:http2';

export type AppleAnswer = { status: number; body: string };

export function postToApple(
	host: string,
	path: string,
	headers: Record<string, string>,
	body: string,
	timeoutMs: number
): Promise<AppleAnswer> {
	return new Promise((resolve, reject) => {
		const session = connect(`https://${host}`);
		const fail = (error: Error) => {
			session.destroy();
			reject(error);
		};
		session.setTimeout(timeoutMs, () => fail(new Error('Apple did not answer in time')));
		session.on('error', fail);
		const request = session.request({ ':method': 'POST', ':path': path, ...headers });
		let status = 0;
		let text = '';
		request.setEncoding('utf8');
		request.on('response', (answered) => {
			status = Number(answered[':status']);
		});
		request.on('data', (chunk: string) => {
			text += chunk;
		});
		request.on('end', () => {
			session.close();
			resolve({ status, body: text });
		});
		request.on('error', fail);
		request.end(body);
	});
}
