import { assets, immutable } from '$app/manifest';
import { version } from '$app/env';
import { startServiceWorker } from './worker';

// Left out of the offline copy: neither is part of the app a device runs.
const NOT_PRECACHED = new Set(['og-preview.png', 'sitemap.xml']);

startServiceWorker(self as unknown as ServiceWorkerGlobalScope, {
	version,
	// Every file of this build, Excalidraw's lazy chunks among them, so a canvas
	// opens offline on a device that never opened one online.
	precache: [
		'/',
		...immutable.map(({ path }) => `/${path}`),
		...assets.filter(({ path }) => !NOT_PRECACHED.has(path)).map(({ path }) => `/${path}`)
	]
});
