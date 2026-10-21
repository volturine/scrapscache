import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ goto: vi.fn().mockResolvedValue(undefined) }));
vi.mock('$app/navigation', () => navigation);
import LabelsScreen from './LabelsScreen.svelte';
import { notesStore } from '#lib/stores/notes.svelte.js';
import { uiStore } from '#lib/stores/ui.svelte.js';

afterEach(() => {
	uiStore.setView('notes');
	uiStore.labelsOpen = false;
	notesStore.labels = [];
	notesStore.notes = [];
	navigation.goto.mockClear();
});

function open() {
	notesStore.labels = [
		{ id: 'travel', name: 'Travel', createdAt: 1, updatedAt: 1 },
		{ id: 'work', name: 'Work', createdAt: 1, updatedAt: 1 }
	];
	uiStore.labelsOpen = true;
	render(LabelsScreen);
}

describe('the phone Labels screen', () => {
	it('lists every label to open or make, then Archive and Trash', () => {
		open();
		const labels = screen.getByRole('region', { name: 'Labels' });
		expect(within(labels).getByRole('button', { name: 'New label' })).toBeTruthy();
		expect(within(labels).getByRole('button', { name: 'Travel' })).toBeTruthy();
		expect(within(labels).getByRole('button', { name: 'Work' })).toBeTruthy();
		const places = screen.getByRole('navigation', { name: 'Archive and Trash' });
		expect(
			within(places)
				.getAllByRole('button')
				.map((row) => row.textContent?.trim())
		).toEqual(['Archive', 'Trash']);
		// The tab bar has the other places; the screen does not repeat them.
		expect(screen.queryByRole('button', { name: 'Notes' })).toBeNull();
	});

	it('goes to Archive and puts itself away', async () => {
		open();
		await fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
		expect(uiStore.view).toBe('archive');
		expect(uiStore.labelsOpen).toBe(false);
		expect(navigation.goto).toHaveBeenCalledWith('/archive');
	});

	it("goes to a label's notes and puts itself away", async () => {
		open();
		await fireEvent.click(screen.getByRole('button', { name: 'Work' }));
		expect(uiStore.view).toBe('label');
		expect(uiStore.activeLabelId).toBe('work');
		expect(uiStore.labelsOpen).toBe(false);
	});
});
