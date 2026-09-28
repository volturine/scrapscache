import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReminderNotificationSettings from './ReminderNotificationSettingsMenuHost.svelte';

afterEach(() => {
	vi.unstubAllGlobals();
});

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

		render(ReminderNotificationSettings);
		await fireEvent.click(screen.getByRole('button', { name: 'Open settings menu' }));
		expect(screen.getByText('Not set')).toBeTruthy();
		const enableItem = screen.getByRole('menuitem', { name: 'Turn on notifications' });
		await fireEvent.pointerDown(enableItem, { pointerType: 'mouse' });
		await fireEvent.click(enableItem);

		await waitFor(() => {
			expect(screen.getByText('Enabled')).toBeTruthy();
		});
		expect(notification.requestPermission).toHaveBeenCalledOnce();
		expect(screen.queryByRole('menuitem', { name: 'Turn on notifications' })).toBeNull();
	});

	it('shows denied permission as disabled without recovery instructions', async () => {
		vi.stubGlobal('Notification', {
			permission: 'denied',
			requestPermission: vi.fn()
		});

		render(ReminderNotificationSettings);
		await fireEvent.click(screen.getByRole('button', { name: 'Open settings menu' }));

		expect(screen.getByText('Disabled')).toBeTruthy();
		expect(screen.queryByText('Not set')).toBeNull();
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
	});
});
