import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('#lib/editorContext.js', () => ({
	useEditorActions: () => ({ startNewNote: vi.fn(), closeNote: vi.fn() })
}));

import Topbar from './Topbar.svelte';

describe('Topbar search', () => {
	it('names the search field and puts it in a search landmark', () => {
		render(Topbar);

		const landmark = screen.getByRole('search');
		const field = within(landmark).getByRole('searchbox', { name: 'Search notes' });
		expect(field.getAttribute('placeholder')).toBe('Search');
	});
});
