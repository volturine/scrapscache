/** Where SvelteKit serves the build of src/service-worker. */
export const SERVICE_WORKER_URL = '/service-worker.js';

/**
 * Register the service worker for the app, or for a narrower scope. It is an
 * ES module (it imports the app's runtime env), and `updateViaCache: 'none'`
 * makes every update check fetch it and its imports fresh, so a deploy reaches
 * a device on its next load. Registering a scope that already runs this worker
 * resolves with that registration; one still running an older script URL is
 * moved onto this one.
 */
export function registerServiceWorker(scope?: string): Promise<ServiceWorkerRegistration> {
	return navigator.serviceWorker.register(SERVICE_WORKER_URL, {
		type: 'module',
		updateViaCache: 'none',
		...(scope ? { scope } : {})
	});
}
