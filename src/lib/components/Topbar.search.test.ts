import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uiStore } from '#lib/stores/ui.svelte.js';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('#lib/editorContext.js', () => ({
	useEditorActions: () => ({ startNewNote: vi.fn(), closeNote: vi.fn() })
}));

import Topbar from './Topbar.svelte';

describe('Topbar search', () => {
	afterEach(() => {
		uiStore.clearSearch();
	});

	it('returns focus to the field when the search is cleared', async () => {
		render(Topbar);
		const field = screen.getByRole('searchbox', { name: 'Search notes' }) as HTMLInputElement;
		await fireEvent.input(field, { target: { value: 'milk' } });
		const clear = screen.getByRole('button', { name: 'Clear search' });
		clear.focus();

		await fireEvent.click(clear);

		expect(field.value).toBe('');
		expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
		expect(document.activeElement).toBe(field);
	});

	it('names the search field and puts it in a search landmark', () => {
		render(Topbar);

		const landmark = screen.getByRole('search');
		const field = within(landmark).getByRole('searchbox', { name: 'Search notes' });
		expect(field.getAttribute('placeholder')).toBe('Search');
	});
});
