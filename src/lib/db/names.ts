// The device's database names and stores, shared by the app and the service
// worker, which reads reminders and writes their receipts without the app open.

/** Lists this device's workspaces for the service worker; never names or sync keys. */
export const DEVICE_DB_NAME = 'scrapscache-device';
export const DEVICE_DB_VERSION = 2;
export const WORKSPACES_STORE = 'workspaces';
export const LINK_PREVIEWS_STORE = 'link-previews';
/** Small device-wide facts that must survive a killed browser, unlike localStorage. */
export const DEVICE_STATE_STORE = 'device-state';

export const NOTES_STORE = 'notes';
export const SYNC_STATE_STORE = 'sync-state';

export function resolveDbName(pid: string): string {
	if (!pid) throw new Error('A workspace is required');
	return `scrapscache-profile-${pid}`;
}
