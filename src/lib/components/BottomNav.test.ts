import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import BottomNav from './BottomNav.svelte';

const startNewNote = vi.fn();

vi.mock('$lib/editorContext', () => ({
	useEditorActions: () => ({
		startNewNote,
		openNote: vi.fn(),
		closeNote: vi.fn()
	})
}));

describe('BottomNav', () => {
	it('triggers startNewNote when the floating action button is clicked', async () => {
		render(BottomNav);
		const fab = screen.getByRole('button', { name: 'New note' });
		expect(fab).toBeTruthy();

		await fireEvent.click(fab);
		expect(startNewNote).toHaveBeenCalledTimes(1);
	});

	it('does not render an install control in the floating navigation', () => {
		render(BottomNav);
		expect(screen.queryByRole('button', { name: /install app/i })).toBeNull();
	});
});
