import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

/**
 * Only the canonical public deployment invites crawlers. Preview and self-hosted
 * origins serve the same app over the same paths, and a private notes instance
 * has nothing to gain from being indexed.
 */
export const GET: RequestHandler = () =>
	new Response(
		env.SCRAPSCACHE_ALLOW_INDEXING === 'true'
			? 'User-agent: *\nDisallow:\n'
			: 'User-agent: *\nDisallow: /\n',
		{ headers: { 'content-type': 'text/plain; charset=utf-8' } }
	);
