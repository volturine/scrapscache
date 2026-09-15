import type { RequestHandler } from './$types';
import { getRuntimeSettings } from '$lib/server/runtimeSettings';

/**
 * Only the canonical public deployment invites crawlers. Preview and self-hosted
 * origins serve the same app over the same paths, and a private notes instance
 * has nothing to gain from being indexed.
 */
export const GET: RequestHandler = async ({ url }) => {
	const settings = await getRuntimeSettings();
	return new Response(
		settings.allowIndexing
			? `User-agent: *\nDisallow:\n\nSitemap: ${url.origin}/sitemap.xml\n`
			: 'User-agent: *\nDisallow: /\n',
		{ headers: { 'content-type': 'text/plain; charset=utf-8' } }
	);
};
