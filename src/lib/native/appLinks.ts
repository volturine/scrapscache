// Links to the web app that iOS opens in the iPhone app instead. The server's
// apple-app-site-association file says which (see #lib/server/appLinks): a
// shared note, a pairing link.
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';

/** What such a link opens is all in its fragment; null for anything that is not one. */
export function linkFragment(link: string): string | null {
	let url: URL;
	try {
		url = new URL(link);
	} catch {
		return null;
	}
	return url.protocol === 'https:' && url.hash.length > 1 ? url.hash : null;
}

/**
 * Take a link's fragment as the page's own, which follows it as a browser tab
 * follows a link pasted into it. iOS keeps the link the app was launched by
 * until this listens, so a link that starts the app is followed too.
 */
export function onAppLink(): Promise<PluginListenerHandle> {
	return App.addListener('appUrlOpen', ({ url }) => {
		const fragment = linkFragment(url);
		if (fragment) window.location.hash = fragment;
	});
}
