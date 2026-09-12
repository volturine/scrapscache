import { timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { checkAdminApiLimit, rateLimitResponse } from '$lib/server/rateLimit';

export function timingSafeStringEqual(left: string, right: string): boolean {
	const leftBuf = Buffer.from(left);
	const rightBuf = Buffer.from(right);
	const length = Math.max(leftBuf.length, rightBuf.length, 1);
	const paddedLeft = Buffer.alloc(length);
	const paddedRight = Buffer.alloc(length);
	leftBuf.copy(paddedLeft);
	rightBuf.copy(paddedRight);
	return timingSafeEqual(paddedLeft, paddedRight) && leftBuf.length === rightBuf.length;
}

export function isAdminAuthorized(
	request: Request,
	expected = env.SCRAPSCACHE_ADMIN_TOKEN
): boolean {
	if (!expected) return false;
	return timingSafeStringEqual(request.headers.get('authorization') ?? '', `Bearer ${expected}`);
}

export function unauthorizedAdminResponse(): Response {
	return new Response('Not found\n', { status: 404 });
}

/**
 * Throttle, then authenticate, then hand control back. Returns the response to
 * send when the caller should not proceed, and null when it should.
 *
 * Throttling first is deliberate: it is what makes guessing the token expensive,
 * and a check that only runs for callers who already know the token protects
 * nothing.
 */
export async function requireAdmin(
	request: Request,
	getClientAddress: () => string
): Promise<Response | null> {
	const limit = await checkAdminApiLimit(getClientAddress);
	if (!limit.allowed) return rateLimitResponse(limit);
	if (!isAdminAuthorized(request)) return unauthorizedAdminResponse();
	return null;
}
