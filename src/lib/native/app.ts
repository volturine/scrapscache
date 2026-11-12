import { useNotificationBackend } from '#lib/reminderNotify.js';
import { reminderStore } from '#lib/stores/reminders.svelte.js';
import {
	currentPermission,
	onNotificationTap,
	refreshPermission,
	removeDeliveredReminders,
	requestPermission,
	scheduleReminderNotifications
} from './localNotifications.js';
import { onRemotePush, registerRemotePush } from './remotePush.js';
import { attachNativeStatusBar } from './statusBar.js';
import { attachReservedRegions } from './reservedRegions.js';

/**
 * What the iPhone app adds to the shell once it is on screen: the status bar
 * follows the theme and leaves the folded Duo's side, the rail keeps under what
 * iOS draws in that side's column, and the system fires reminders from the
 * store's schedule and drops the ones answered since. The relay pushes the
 * reminders the schedule does not hold yet, once it knows which it does.
 */
export function attachNativeApp(): () => void {
	const stopStatusBar = attachNativeStatusBar();
	const stopReservedRegions = attachReservedRegions();
	const schedule = () => {
		if (currentPermission() !== 'granted') {
			// Nothing to schedule, and nowhere to register; a workspace unlinked
			// since the phone registered is still one to take it off.
			void registerRemotePush(null);
			return;
		}
		const upcoming = reminderStore.upcoming();
		void scheduleReminderNotifications(upcoming)
			.then(() => registerRemotePush(upcoming))
			.catch(() => undefined);
	};
	useNotificationBackend({
		permission: currentPermission,
		request: async () => {
			const granted = await requestPermission();
			schedule();
			return granted;
		},
		close: removeDeliveredReminders
	});
	void refreshPermission().then(schedule);
	const stopUpcoming = reminderStore.watchUpcoming(schedule);
	const tap = onNotificationTap((extra) => reminderStore.openFromSystem(extra));
	const push = onRemotePush(() => void reminderStore.syncAllRemoteWakes());
	return () => {
		stopStatusBar();
		stopReservedRegions();
		stopUpcoming();
		useNotificationBackend(null);
		void tap.then((handle) => handle.remove()).catch(() => undefined);
		void push.then((handle) => handle.remove()).catch(() => undefined);
	};
}
