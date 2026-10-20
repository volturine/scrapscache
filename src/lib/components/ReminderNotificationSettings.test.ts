import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pwaInstallStore } from '#lib/stores/pwaInstall.svelte.js';
import ReminderNotificationSettings from './ReminderNotificationSettingsMenuHost.svelte';

afterEach(() => {
	vi.unstubAllGlobals();
	pwaInstallStore.isStandalone = false;
});

async function openMenu() {
	render(ReminderNotificationSettings);
	await fireEvent.click(screen.getByRole('button', { name: 'Open settings menu' }));
}

describe('ReminderNotificationSettings', () => {
	it('requests permission and shows the device as enabled', async () => {
		const notification = {
			permission: 'default' as NotificationPermission,
			requestPermission: vi.fn(async () => {
				notification.permission = 'granted';
				return 'granted' as NotificationPermission;
			})
		};
		vi.stubGlobal('Notification', notification);

		await openMenu();
		expect(screen.getByText('Off. Tap to turn them on.')).toBeTruthy();
		expect(screen.queryByText(/Blocked/)).toBeNull();
		const enableItem = screen.getByRole('menuitem', { name: 'Turn on reminder alerts' });
		await fireEvent.pointerDown(enableItem, { pointerType: 'mouse' });
		await fireEvent.click(enableItem);

		await waitFor(() => {
			expect(screen.getByText('On. This device shows them.')).toBeTruthy();
		});
		expect(notification.requestPermission).toHaveBeenCalledOnce();
		expect(screen.queryByRole('menuitem', { name: 'Turn on reminder alerts' })).toBeNull();
		expect(screen.queryByText(/Blocked in the browser/)).toBeNull();
	});

	it('shows denied permission as disabled and says how to unblock it', async () => {
		vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() });

		await openMenu();

		expect(screen.queryByText(/Tap to turn them on/)).toBeNull();
		// The page cannot ask again once the browser blocks it; only site settings can.
		// The sentence describes the item, so moving through the menu reaches it.
		expect(
			screen.getByRole('menuitem', {
				name: 'Reminder alerts',
				description: 'Blocked in the browser. Allow notifications for this site in its settings.'
			})
		).toBeTruthy();
	});

	it('points an installed app to its own notification settings', async () => {
		vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() });
		pwaInstallStore.isStandalone = true;

		await openMenu();

		expect(
			screen.getByRole('menuitem', {
				name: 'Reminder alerts',
				description:
					"Blocked for this app. Allow notifications for Scraps Cache in the app's settings or your device's notification settings."
			})
		).toBeTruthy();
	});

	it('says notifications are unsupported, with nothing to unblock', async () => {
		vi.stubGlobal('Notification', undefined);

		await openMenu();

		expect(
			screen.getByRole('menuitem', {
				name: 'Reminder alerts',
				description: 'This browser cannot show them.'
			})
		).toBeTruthy();
		expect(screen.queryByText(/Blocked/)).toBeNull();
	});

	it('refreshes after permission is changed in device settings', async () => {
		const notification = {
			permission: 'denied' as NotificationPermission,
			requestPermission: vi.fn()
		};
		vi.stubGlobal('Notification', notification);
		render(ReminderNotificationSettings);
		await fireEvent.click(screen.getByRole('button', { name: 'Open settings menu' }));

		notification.permission = 'granted';
		window.dispatchEvent(new Event('focus'));

		await waitFor(() => expect(screen.getByText('On. This device shows them.')).toBeTruthy());
		expect(screen.queryByText(/Blocked in the browser/)).toBeNull();
	});
});
