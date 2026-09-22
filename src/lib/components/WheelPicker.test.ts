import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import WheelPicker from './WheelPicker.svelte';

const testItems = [
	{ value: 0, label: '00' },
	{ value: 1, label: '01' },
	{ value: 2, label: '02' },
	{ value: 3, label: '03' },
	{ value: 4, label: '04' }
];

describe('WheelPicker', () => {
	it('renders primary options and marks the active descendant for current value', () => {
		render(WheelPicker, {
			props: {
				items: testItems,
				value: 2,
				onChange: () => {},
				ariaLabel: 'Test Picker'
			}
		});

		const listbox = screen.getByRole('listbox', { name: 'Test Picker' });
		expect(listbox).toBeTruthy();

		const options = listbox.querySelectorAll('[role="option"]');
		expect(options).toHaveLength(5);
		expect(options[2].getAttribute('aria-selected')).toBe('true');
		expect(listbox.getAttribute('aria-activedescendant')).toBe(options[2].id);
	});

	it('navigates with keyboard ArrowDown and ArrowUp', async () => {
		const onChange = vi.fn();
		render(WheelPicker, {
			props: {
				items: testItems,
				value: 2,
				onChange,
				ariaLabel: 'Test Picker'
			}
		});

		const listbox = screen.getByRole('listbox', { name: 'Test Picker' });
		await fireEvent.keyDown(listbox, { key: 'ArrowDown' });
		expect(onChange).toHaveBeenCalledWith(3);

		await fireEvent.keyDown(listbox, { key: 'ArrowUp' });
		expect(onChange).toHaveBeenCalledWith(1);
	});

	it('selects option on click', async () => {
		const onChange = vi.fn();
		render(WheelPicker, {
			props: {
				items: testItems,
				value: 2,
				onChange,
				ariaLabel: 'Test Picker'
			}
		});

		const option = screen.getByRole('option', { name: '04' });
		await fireEvent.click(option);
		expect(onChange).toHaveBeenCalledWith(4);
	});
});
