import { useNotificationBackend } from '#lib/reminderNotify.js';
import { reminderStore } from '#lib/stores/reminders.svelte.js';
import {
	currentPermission,
	onNotificationTap,
	refreshPermission,
	requestPermission,
	scheduleReminderNotifications
} from './localNotifications.js';
import { attachNativeStatusBar } from './statusBar.js';

/**
 * What the iPhone app adds to the shell once it is on screen: the status bar
 * follows the theme and leaves the folded Duo's side, and the system fires
 * reminders from the store's schedule.
 */
export function attachNativeApp(): () => void {
	const stopStatusBar = attachNativeStatusBar();
	const schedule = () => {
		if (currentPermission() !== 'granted') return;
		void scheduleReminderNotifications(reminderStore.upcoming()).catch(() => undefined);
	};
	useNotificationBackend({
		permission: currentPermission,
		request: async () => {
			const granted = await requestPermission();
			schedule();
			return granted;
		}
	});
	void refreshPermission().then(schedule);
	const stopUpcoming = reminderStore.watchUpcoming(schedule);
	const tap = onNotificationTap((extra) => reminderStore.openFromSystem(extra));
	return () => {
		stopStatusBar();
		stopUpcoming();
		useNotificationBackend(null);
		void tap.then((handle) => handle.remove()).catch(() => undefined);
	};
}
