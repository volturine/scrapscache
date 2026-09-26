import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import LabelChecklist from './LabelChecklist.svelte';

const labels = ['Work', 'Home', 'Workshop'].map((name) => ({
	id: name.toLowerCase(),
	name,
	createdAt: 1,
	updatedAt: 1
}));

function names(): string[] {
	return [...document.querySelectorAll('[data-part="label"]')].map((el) => el.textContent ?? '');
}

describe('LabelChecklist', () => {
	it('narrows the list as the search is typed, and says when nothing matches', async () => {
		render(LabelChecklist, {
			props: { labels, selected: [], onToggle: vi.fn(), label: 'Board filter labels' }
		});
		const search = screen.getByRole('searchbox', { name: 'Search board filter labels' });

		await fireEvent.input(search, { target: { value: 'work' } });
		expect(names()).toEqual(['Work', 'Workshop']);

		await fireEvent.input(search, { target: { value: 'zzz' } });
		expect(names()).toEqual([]);
		expect(screen.getByText('No labels match “zzz”.')).toBeTruthy();
	});

	it('toggles a label, and keeps a selection the search hides', async () => {
		const onToggle = vi.fn();
		render(LabelChecklist, {
			props: { labels, selected: ['home'], onToggle, label: 'Board filter labels' }
		});

		await fireEvent.click(screen.getByText('Work'));
		expect(onToggle).toHaveBeenCalledWith('work');

		await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'work' } });
		expect(onToggle).toHaveBeenCalledTimes(1);
	});

	it('clears the search on Escape before anything else hears it', async () => {
		const outer = vi.fn();
		render(LabelChecklist, {
			props: { labels, selected: [], onToggle: vi.fn(), label: 'Board filter labels' }
		});
		window.addEventListener('keydown', outer);
		const search = screen.getByRole('searchbox') as HTMLInputElement;

		await fireEvent.input(search, { target: { value: 'work' } });
		await fireEvent.keyDown(search, { key: 'Escape' });

		expect(search.value).toBe('');
		expect(names()).toEqual(['Work', 'Home', 'Workshop']);
		expect(outer).not.toHaveBeenCalled();
		window.removeEventListener('keydown', outer);
	});
});
