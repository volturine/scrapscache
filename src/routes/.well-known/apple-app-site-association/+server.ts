import type { RequestHandler } from './$types';
import { appSiteAssociation } from '#lib/server/appLinks.js';

/**
 * Apple reads this file to learn which links to this server open in the iPhone
 * app. It must be JSON at exactly this address, with no redirect on the way.
 */
export const GET: RequestHandler = () => {
	const association = appSiteAssociation();
	if (!association) return new Response('Not found\n', { status: 404 });
	return new Response(JSON.stringify(association), {
		headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' }
	});
};
