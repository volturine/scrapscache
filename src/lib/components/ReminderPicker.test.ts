import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReminderPicker from './ReminderPicker.svelte';

const reminder = new Date(2026, 7, 12, 15, 30, 0, 0).getTime();

afterEach(() => {
	vi.useRealTimers();
});

describe('ReminderPicker date and time controls', () => {
	it('shows a 24-hour wheel and per-minute steps', () => {
		render(ReminderPicker, { props: { reminder, onClose: () => {} } });

		const hourOptions = screen
			.getByRole('listbox', { name: 'Hour' })
			.querySelectorAll('[role="option"]');
		expect(hourOptions).toHaveLength(24);
		expect(hourOptions[0].textContent).toBe('00');
		expect(hourOptions[23].textContent).toBe('23');
		expect(hourOptions[15].getAttribute('aria-selected')).toBe('true');
		expect(screen.queryByRole('listbox', { name: 'AM/PM' })).toBeNull();

		const minuteBox = screen.getByRole('listbox', { name: 'Minute' });
		const minuteOptions = minuteBox.querySelectorAll('[role="option"]');
		expect(minuteOptions).toHaveLength(60);
		expect(minuteOptions[0].textContent).toBe('00');
		expect(minuteOptions[1].textContent).toBe('01');
		expect(minuteOptions[59].textContent).toBe('59');
		expect(minuteOptions[30].getAttribute('aria-selected')).toBe('true');
	});

	it('opens a date picker when the date label is pressed', async () => {
		render(ReminderPicker, { props: { reminder, onClose: () => {} } });

		expect(screen.queryByRole('grid')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));

		expect(screen.getByRole('grid')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Switch to month view' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Choose date' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Previous day' })).toBeNull();
		expect(screen.queryByRole('listbox', { name: 'Minute' })).toBeNull();
	});

	it('keeps day arrows independent of the date picker', async () => {
		render(ReminderPicker, { props: { reminder, onClose: () => {} } });

		await fireEvent.click(screen.getByRole('button', { name: 'Next day' }));

		expect(screen.getByRole('button', { name: 'Choose date' }).textContent).toContain('13');
		expect(screen.queryByRole('grid')).toBeNull();
	});

	it('changes the selected day from the date picker', async () => {
		render(ReminderPicker, { props: { reminder, onClose: () => {} } });

		await fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
		await fireEvent.click(within(screen.getByRole('grid')).getByText('21'));

		expect(screen.queryByRole('grid')).toBeNull();
		expect(screen.getByRole('button', { name: 'Choose date' }).textContent).toContain('21');
	});

	it('jumps months from the month grid', async () => {
		render(ReminderPicker, { props: { reminder, onClose: () => {} } });

		await fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Switch to month view' }));
		await fireEvent.click(screen.getByText('Oct'));

		expect(screen.getByRole('button', { name: 'Switch to month view' }).textContent).toContain(
			'October'
		);
		expect(screen.getByRole('grid')).toBeTruthy();
	});

	it('wraps the hour wheel from 23 to 00', async () => {
		const late = new Date(2026, 7, 12, 23, 30, 0, 0).getTime();
		render(ReminderPicker, { props: { reminder: late, onClose: () => {} } });

		await fireEvent.keyDown(screen.getByRole('listbox', { name: 'Hour' }), { key: 'ArrowDown' });

		expect(
			within(screen.getByRole('listbox', { name: 'Hour' }))
				.getByRole('option', { name: '00' })
				.getAttribute('aria-selected')
		).toBe('true');
	});

	it('wraps the minute wheel from 00 to 59', async () => {
		const onHour = new Date(2026, 7, 12, 15, 0, 0, 0).getTime();
		render(ReminderPicker, { props: { reminder: onHour, onClose: () => {} } });

		await fireEvent.keyDown(screen.getByRole('listbox', { name: 'Minute' }), { key: 'ArrowUp' });

		expect(
			within(screen.getByRole('listbox', { name: 'Minute' }))
				.getByRole('option', { name: '59' })
				.getAttribute('aria-selected')
		).toBe('true');
	});
});

describe('ReminderPicker mobile wheel controls', () => {
	it('switches between time wheels and date wheels on mobile', async () => {
		render(ReminderPicker, { props: { reminder, onClose: () => {}, forceMode: 'mobile' } });

		// Initially shows time wheels
		expect(screen.getByRole('listbox', { name: 'Hour' })).toBeTruthy();
		expect(screen.getByRole('listbox', { name: 'Minute' })).toBeTruthy();
		expect(screen.queryByRole('listbox', { name: 'Day' })).toBeNull();
		expect(screen.queryByRole('grid')).toBeNull();

		// Clicking date button toggles to date wheels
		await fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
		expect(screen.getByRole('listbox', { name: 'Day' })).toBeTruthy();
		expect(screen.getByRole('listbox', { name: 'Month' })).toBeTruthy();
		expect(screen.getByRole('listbox', { name: 'Year' })).toBeTruthy();
		expect(screen.queryByRole('listbox', { name: 'Hour' })).toBeNull();
		expect(screen.queryByRole('grid')).toBeNull();

		// Selecting a day on mobile wheel
		await fireEvent.click(
			within(screen.getByRole('listbox', { name: 'Day' })).getByRole('option', { name: '20' })
		);
		expect(screen.getByRole('button', { name: 'Choose date' }).textContent).toContain('20');

		// Clicking date button again toggles back to time wheels
		await fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
		expect(screen.getByRole('listbox', { name: 'Hour' })).toBeTruthy();
		expect(screen.getByRole('listbox', { name: 'Minute' })).toBeTruthy();
		expect(screen.queryByRole('listbox', { name: 'Day' })).toBeNull();
	});
});

describe('ReminderPicker remaining time', () => {
	it('shows time left and only the closed-app sync note', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 7, 12, 14, 30, 0, 0));
		render(ReminderPicker, { props: { reminder, onClose: () => {} } });

		expect(screen.getByText('in 1 hour')).toBeTruthy();
		expect(screen.queryByText(/Notifies on this device/)).toBeNull();
		expect(screen.getByText('Closed-app alerts need Sync on this device.')).toBeTruthy();
	});

	it('keeps cancel on the left with remove, and save on the right after edit', async () => {
		render(ReminderPicker, { props: { reminder, onClose: () => {} } });

		const remove = screen.getByRole('button', { name: 'Remove' });
		const cancel = screen.getByRole('button', { name: 'Cancel' });
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
		expect(remove.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

		await fireEvent.click(
			within(screen.getByRole('listbox', { name: 'Hour' })).getByRole('option', { name: '16' })
		);

		const save = screen.getByRole('button', { name: 'Save' });
		expect(cancel.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('opens the calendar inside the same date-time panel', async () => {
		const { container } = render(ReminderPicker, { props: { reminder, onClose: () => {} } });
		const panel = container.querySelector('.schedule-panel');
		expect(panel).toBeTruthy();
		expect(panel?.querySelector('[aria-label=\"Hour\"]')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));

		expect(panel?.querySelector('[role=\"grid\"]')).toBeTruthy();
		expect(panel?.querySelector('[aria-label=\"Hour\"]')).toBeNull();
	});

	it('updates remaining time when the hour changes', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 7, 12, 14, 30, 0, 0));
		render(ReminderPicker, { props: { reminder, onClose: () => {} } });

		await fireEvent.click(
			within(screen.getByRole('listbox', { name: 'Hour' })).getByRole('option', { name: '16' })
		);

		expect(screen.getByText('in 2 hours')).toBeTruthy();
	});

	it('counts down while the picker stays open', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 7, 12, 14, 29, 0, 0));
		render(ReminderPicker, { props: { reminder, onClose: () => {} } });

		expect(screen.getByText('in 1 hour 1 minute')).toBeTruthy();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(screen.getByText('in 1 hour')).toBeTruthy();
	});
});
