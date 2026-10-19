import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SearchAnnouncer from './SearchAnnouncer.svelte';

describe('SearchAnnouncer', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('speaks once the search settles, not on every key', async () => {
		const { container, rerender } = render(SearchAnnouncer, { props: { message: '' } });
		const region = container.querySelector('[aria-live="polite"]')!;
		expect(region.textContent).toBe('');

		await rerender({ message: 'No notes match “re”. Look in Archive.' });
		await vi.advanceTimersByTimeAsync(300);
		await rerender({ message: 'No notes match “retro”. Look in Archive.' });
		await vi.advanceTimersByTimeAsync(600);
		// Still typing: nothing said yet.
		expect(region.textContent).toBe('');

		await vi.advanceTimersByTimeAsync(100);
		expect(region.textContent).toBe('No notes match “retro”. Look in Archive.');
	});

	it('clears what it said when results come back', async () => {
		const { container, rerender } = render(SearchAnnouncer, {
			props: { message: 'No notes match “retro”. Look in Trash.' }
		});
		await vi.advanceTimersByTimeAsync(700);
		const region = container.querySelector('[aria-live="polite"]')!;
		expect(region.textContent).toBe('No notes match “retro”. Look in Trash.');

		await rerender({ message: '' });

		expect(region.textContent).toBe('');
	});
});
