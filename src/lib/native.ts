import { Capacitor } from '@capacitor/core';

/** True inside the iPhone app, where the page is bundled and the server is elsewhere. */
export function isNativeApp(): boolean {
	return Capacitor.isNativePlatform();
}
