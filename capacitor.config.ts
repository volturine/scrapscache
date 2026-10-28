/// <reference types="@capacitor/local-notifications" />
/// <reference types="@capacitor/status-bar" />
import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The iPhone app: the static build (`npm run build:ios`) inside a WKWebView. The
 * server it talks to is a setting in the app, not part of this file.
 */
const config: CapacitorConfig = {
	appId: 'com.scrapscache.app',
	appName: 'Scraps Cache',
	webDir: 'build/ios',
	ios: {
		// The page lays itself out around the safe area (see #lib/appViewport);
		// the web view must not pad it again.
		contentInset: 'never'
	},
	plugins: {
		LocalNotifications: {
			// While the app is open the reminder store shows the alert itself; a
			// banner on top of it would say the same thing twice.
			presentationOptions: []
		},
		StatusBar: {
			overlaysWebView: true
		}
	}
};

export default config;
