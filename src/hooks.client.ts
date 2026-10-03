import { installHorizontalWheel } from '#lib/horizontalWheel.js';
import { reloadOnceForMissingModule } from '#lib/staleModuleReload.js';

export function init() {
	installHorizontalWheel();
	window.addEventListener('vite:preloadError', (event) => {
		const payload = 'payload' in event ? event.payload : undefined;
		reloadOnceForMissingModule(
			payload instanceof Error ? payload : new Error('Failed to fetch dynamically imported module')
		);
	});
}
