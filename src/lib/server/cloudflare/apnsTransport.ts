// One request to Apple's push service from a Worker, whose `fetch` speaks the
// HTTP/2 Apple requires.
export type AppleAnswer = { status: number; body: string };

export async function postToApple(
	host: string,
	path: string,
	headers: Record<string, string>,
	body: string,
	timeoutMs: number
): Promise<AppleAnswer> {
	const response = await fetch(`https://${host}${path}`, {
		method: 'POST',
		// Apple answers in place; a redirect is a failed send, never followed.
		redirect: 'manual',
		signal: AbortSignal.timeout(timeoutMs),
		headers,
		body
	});
	return { status: response.status, body: await response.text() };
}
