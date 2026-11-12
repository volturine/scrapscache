// Links to the web app that iOS opens in the iPhone app instead. The server's
// apple-app-site-association file says which (see #lib/server/appLinks): a
// link to a note, a pairing link.
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { serverSetting } from '#lib/serverOrigin.svelte.js';

/**
 * What a link opens is all in its fragment; null for a link that is not this
 * app's to follow. iOS hands over the links of the hosts the app was built to
 * claim, whichever server it has since been pointed at: a link to another
 * server names a workspace or a pairing that this one knows nothing of.
 */
export function linkFragment(link: string, server: string): string | null {
	let url: URL;
	try {
		url = new URL(link);
	} catch {
		return null;
	}
	return url.origin === server && url.hash.length > 1 ? url.hash : null;
}

/**
 * Take a link's fragment as the page's own, which follows it as a browser tab
 * follows a link pasted into it. iOS keeps the link the app was launched by
 * until this listens, so a link that starts the app is followed too.
 */
export function onAppLink(): Promise<PluginListenerHandle> {
	return App.addListener('appUrlOpen', ({ url }) => {
		const fragment = linkFragment(url, serverSetting.origin);
		if (fragment) window.location.hash = fragment;
	});
}
