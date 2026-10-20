import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { actionUndo } from '#lib/stores/actionUndo.svelte.js';
import UndoBar from './UndoBar.svelte';

afterEach(() => {
	actionUndo.clear();
});

describe('UndoBar', () => {
	it('keeps its live region mounted, so a new message is announced', async () => {
		render(UndoBar);
		const status = screen.getByRole('status');
		expect(status.textContent?.trim()).toBe('');

		actionUndo.push({ message: 'Moved to Doing', noteIds: [], undo() {}, redo() {} });
		await tick();

		expect(screen.getByRole('status')).toBe(status);
		expect(status.textContent).toContain('Moved to Doing');
		expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
	});
});
