// Which links to this server iOS opens in the iPhone app rather than in Safari
// ("universal links"). iOS asks the server for this file once an app claims the
// server's host, and opens in the app only what both of them name.
import { SCRAPSCACHE_IOS_APP_IDS } from '$app/env/private';

/** An App ID as Apple writes it: the ten-character team prefix, a dot, the bundle ID. */
const APP_ID_RE = /^[A-Z0-9]{10}\.[A-Za-z0-9.-]{1,155}$/;

/**
 * The links worth leaving the browser for carry what they open in their fragment
 * (see #lib/noteLinks and #lib/syncPairing): a note, a pairing code. They are
 * made on whichever view the web app was showing, so the path is left open (a
 * component that names none matches every path); an address without such a
 * fragment stays a web page.
 */
const COMPONENTS = [
	{ '#': '*note=*', comment: 'A link to a note' },
	{ '#': '*pair=*', comment: 'A pairing link' }
];

/** The apps this server's links open in, or none when it names no app. */
export function iosAppIds(): string[] {
	return (SCRAPSCACHE_IOS_APP_IDS ?? '')
		.split(',')
		.map((id) => id.trim())
		.filter((id) => APP_ID_RE.test(id));
}

/** The apple-app-site-association file, or null when this server names no app. */
export function appSiteAssociation(): object | null {
	const appIDs = iosAppIds();
	if (!appIDs.length) return null;
	return { applinks: { details: [{ appIDs, components: COMPONENTS }] } };
}
