import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReminderCalendarTestWrapper from './ReminderCalendarTestWrapper.svelte';
import type { ReminderDayFilter } from './ReminderCalendar.svelte';

function getFilterState(container: HTMLElement): ReminderDayFilter | null {
	const el = container.querySelector('[data-testid="selected-json"]');
	if (!el || !el.textContent) return null;
	return JSON.parse(el.textContent);
}

describe('ReminderCalendar daily and range filtering', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('selects a single day on regular click by default and toggles off on repeat click', async () => {
		const { container } = render(ReminderCalendarTestWrapper, {
			props: { notes: [] }
		});

		const day15 = container.querySelector(
			'button[data-view="day"][data-value$="-15"]'
		) as HTMLButtonElement;
		expect(day15).toBeTruthy();

		await fireEvent.pointerDown(day15);
		await fireEvent.pointerUp(day15);
		await fireEvent.click(day15);
		await tick();

		const selected = getFilterState(container);
		expect(selected).toBeTruthy();
		expect(selected?.from).toMatch(/-15$/);
		expect(selected?.to).toBe(selected?.from);
		expect(container.textContent).toContain('Day filter active');

		// Click day 15 again -> toggles off
		await fireEvent.pointerDown(day15);
		await fireEvent.pointerUp(day15);
		await fireEvent.click(day15);
		await tick();

		expect(getFilterState(container)).toBeNull();
		expect(container.textContent).not.toContain('Day filter active');
	});

	it('switches to range selection on longpress and completes range on next click', async () => {
		const { container } = render(ReminderCalendarTestWrapper, {
			props: { notes: [] }
		});

		const day10 = container.querySelector(
			'button[data-view="day"][data-value$="-10"]'
		) as HTMLButtonElement;
		const day20 = container.querySelector(
			'button[data-view="day"][data-value$="-20"]'
		) as HTMLButtonElement;
		expect(day10).toBeTruthy();
		expect(day20).toBeTruthy();

		// Longpress day 10 (hold for 450ms)
		await fireEvent.pointerDown(day10);
		vi.advanceTimersByTime(450);
		await tick();

		const selectedAfterLongPress = getFilterState(container);
		expect(selectedAfterLongPress).toBeTruthy();
		expect(selectedAfterLongPress?.from).toMatch(/-10$/);
		expect(selectedAfterLongPress?.to).toBeNull();
		expect(container.textContent).toContain('Pick an end day');

		// Releasing day 10 triggers pointerUp and trailing click which should NOT complete or cancel
		await fireEvent.pointerUp(day10);
		await fireEvent.click(day10);
		await tick();
		expect(getFilterState(container)?.to).toBeNull();

		// Clicking day 20 completes the range
		await fireEvent.pointerDown(day20);
		await fireEvent.pointerUp(day20);
		await fireEvent.click(day20);
		await tick();

		const selectedRange = getFilterState(container);
		expect(selectedRange?.from).toMatch(/-10$/);
		expect(selectedRange?.to).toMatch(/-20$/);
		expect(container.textContent).toContain('Range filter active');
	});

	it('handles reverse range selection when end date is before start date', async () => {
		const { container } = render(ReminderCalendarTestWrapper, {
			props: { notes: [] }
		});

		const day20 = container.querySelector(
			'button[data-view="day"][data-value$="-20"]'
		) as HTMLButtonElement;
		const day10 = container.querySelector(
			'button[data-view="day"][data-value$="-10"]'
		) as HTMLButtonElement;

		await fireEvent.pointerDown(day20);
		vi.advanceTimersByTime(450);
		await tick();
		await fireEvent.pointerUp(day20);
		await fireEvent.click(day20);
		await tick();

		await fireEvent.pointerDown(day10);
		await fireEvent.pointerUp(day10);
		await fireEvent.click(day10);
		await tick();

		const selected = getFilterState(container);
		expect(selected?.from).toMatch(/-10$/);
		expect(selected?.to).toMatch(/-20$/);
		expect(container.textContent).toContain('Range filter active');
	});

	it('supports Shift+Click to initiate range selection', async () => {
		const { container } = render(ReminderCalendarTestWrapper, {
			props: { notes: [] }
		});

		const day12 = container.querySelector(
			'button[data-view="day"][data-value$="-12"]'
		) as HTMLButtonElement;
		const day18 = container.querySelector(
			'button[data-view="day"][data-value$="-18"]'
		) as HTMLButtonElement;

		await fireEvent.click(day12, { shiftKey: true });
		await tick();
		const selectedStart = getFilterState(container);
		expect(selectedStart?.from).toMatch(/-12$/);
		expect(selectedStart?.to).toBeNull();
		expect(container.textContent).toContain('Pick an end day');

		await fireEvent.click(day18);
		await tick();
		const selectedRange = getFilterState(container);
		expect(selectedRange?.from).toMatch(/-12$/);
		expect(selectedRange?.to).toMatch(/-18$/);
		expect(container.textContent).toContain('Range filter active');
	});

	it('cancels longpress timer if pointer leaves before 450ms', async () => {
		const { container } = render(ReminderCalendarTestWrapper, {
			props: { notes: [] }
		});

		const day15 = container.querySelector(
			'button[data-view="day"][data-value$="-15"]'
		) as HTMLButtonElement;

		await fireEvent.pointerDown(day15);
		vi.advanceTimersByTime(200);
		await fireEvent.pointerLeave(day15);
		vi.advanceTimersByTime(300);
		await tick();

		expect(getFilterState(container)).toBeNull();
	});

	it('supports Today and Clear buttons', async () => {
		const { container } = render(ReminderCalendarTestWrapper, {
			props: { notes: [] }
		});

		const todayBtn = screen.getByRole('button', { name: 'Today' });
		const clearBtn = screen.getByRole('button', { name: 'Clear' });

		await fireEvent.click(todayBtn);
		await tick();
		const selected = getFilterState(container);
		expect(selected).toBeTruthy();
		expect(selected?.from).toBe(selected?.to);
		expect(container.textContent).toContain('Day filter active');

		await fireEvent.click(clearBtn);
		await tick();
		expect(getFilterState(container)).toBeNull();
	});
});
