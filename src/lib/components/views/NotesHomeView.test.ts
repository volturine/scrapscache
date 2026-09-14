import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import NotesHomeView from './NotesHomeView.svelte';

const startNewNote = vi.fn();
const openNote = vi.fn();

vi.mock('$lib/editorContext', () => ({
	useEditorActions: () => ({
		startNewNote,
		openNote,
		closeNote: vi.fn()
	})
}));

describe('NotesHomeView', () => {
	it('renders CTA above the fold on empty state and triggers startNewNote', async () => {
		render(NotesHomeView);

		const cta = screen.getByRole('button', { name: 'Take a note' });
		expect(cta).toBeTruthy();

		await fireEvent.click(cta);
		expect(startNewNote).toHaveBeenCalledTimes(1);
	});
});
