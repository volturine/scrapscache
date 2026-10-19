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
		expect(screen.getByText('Not set')).toBeTruthy();
		expect(screen.queryByText(/Blocked/)).toBeNull();
		const enableItem = screen.getByRole('menuitem', { name: 'Turn on notifications' });
		await fireEvent.pointerDown(enableItem, { pointerType: 'mouse' });
		await fireEvent.click(enableItem);

		await waitFor(() => {
			expect(screen.getByText('Enabled')).toBeTruthy();
		});
		expect(notification.requestPermission).toHaveBeenCalledOnce();
		expect(screen.queryByRole('menuitem', { name: 'Turn on notifications' })).toBeNull();
		expect(screen.queryByText(/Blocked in the browser/)).toBeNull();
	});

	it('shows denied permission as disabled and says how to unblock it', async () => {
		vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() });

		await openMenu();

		expect(screen.queryByText('Not set')).toBeNull();
		// The page cannot ask again once the browser blocks it; only site settings can.
		// The hint describes the item, so moving through the menu reaches it.
		expect(
			screen.getByRole('menuitem', {
				name: /Notifications\s*Disabled/,
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
				name: /Notifications\s*Disabled/,
				description:
					"Blocked for this app. Allow notifications for Scraps Cache in the app's settings or your device's notification settings."
			})
		).toBeTruthy();
	});

	it('says notifications are unsupported, with nothing to unblock', async () => {
		vi.stubGlobal('Notification', undefined);

		await openMenu();

		expect(screen.getByRole('menuitem', { name: /Notifications\s*Unsupported/ })).toBeTruthy();
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

		await waitFor(() => expect(screen.getByText('Enabled')).toBeTruthy());
		expect(screen.queryByText(/Blocked in the browser/)).toBeNull();
	});
});
