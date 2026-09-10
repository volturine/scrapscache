import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import Sidebar from './Sidebar.svelte';
import { notesStore } from '$lib/stores/notes.svelte';
import type { Label } from '$lib/types';

function label(name: string, id = name.toLowerCase()): Label {
	return { id, name, createdAt: 1, updatedAt: 1 };
}

function setup(labels: Label[]) {
	notesStore.notes = [];
	notesStore.labels = labels;
	const { container } = render(Sidebar, { props: {} });
	const section = container.querySelector('[data-labels-edit]') as HTMLElement;
	return { container, section };
}

const editToggle = (section: HTMLElement) =>
	section.querySelector(
		'button[aria-label="Edit labels"], button[aria-label="Finish editing labels"]'
	) as HTMLButtonElement;

afterEach(() => {
	vi.restoreAllMocks();
});

describe('Sidebar labels section', () => {
	it('toggles edit mode from a single control that keeps its place', async () => {
		const { section } = setup([label('Work')]);

		const toggle = editToggle(section);
		expect(toggle.textContent?.trim()).toBe('Edit');

		await fireEvent.click(toggle);
		await tick();

		// Same element, so the header cannot reflow when the mode changes.
		expect(editToggle(section)).toBe(toggle);
		expect(toggle.textContent?.trim()).toBe('Done');
		expect(toggle.getAttribute('aria-label')).toBe('Finish editing labels');
		expect(section.querySelectorAll('button[aria-label="Edit labels"]').length).toBe(0);

		await fireEvent.click(toggle);
		await tick();
		expect(toggle.textContent?.trim()).toBe('Edit');
	});

	it('offers a new label row and a delete control per label in edit mode', async () => {
		const { section } = setup([label('Work'), label('Ideas')]);

		expect(section.querySelector('button[aria-label="Delete Work"]')).toBeNull();

		await fireEvent.click(editToggle(section));
		await tick();

		expect(section.textContent).toContain('New label');
		expect(section.querySelector('button[aria-label="Delete Work"]')).toBeTruthy();
		expect(section.querySelector('button[aria-label="Delete Ideas"]')).toBeTruthy();
	});

	it('keeps the delete control in place while a label is being renamed', async () => {
		const { section } = setup([label('Work'), label('Ideas')]);
		await fireEvent.click(editToggle(section));
		await tick();

		await fireEvent.click(section.querySelector('button[aria-label="Rename Work"]') as HTMLElement);
		await tick();

		// The name button becomes a field, but the row keeps every other control so
		// the list does not shift under the pointer.
		expect(section.querySelector('button[aria-label="Rename Work"]')).toBeNull();
		expect(section.querySelector('input[aria-label="Rename Work"]')).toBeTruthy();
		expect(section.querySelector('button[aria-label="Delete Work"]')).toBeTruthy();
		expect(section.querySelector('button[aria-label="Delete Ideas"]')).toBeTruthy();
	});

	it('commits a rename on Enter and abandons it on Escape', async () => {
		const renameLabel = vi.spyOn(notesStore, 'renameLabel').mockImplementation(() => {});
		const { section } = setup([label('Work')]);
		await fireEvent.click(editToggle(section));
		await tick();

		await fireEvent.click(section.querySelector('button[aria-label="Rename Work"]') as HTMLElement);
		await tick();
		let input = section.querySelector('input[aria-label="Rename Work"]') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'Errands' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		await tick();
		expect(renameLabel).toHaveBeenCalledWith('work', 'Errands');

		renameLabel.mockClear();
		await fireEvent.click(section.querySelector('button[aria-label="Rename Work"]') as HTMLElement);
		await tick();
		input = section.querySelector('input[aria-label="Rename Work"]') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'Discarded' } });
		await fireEvent.keyDown(input, { key: 'Escape' });
		await tick();
		expect(renameLabel).not.toHaveBeenCalled();
		expect(section.querySelector('button[aria-label="Rename Work"]')).toBeTruthy();
	});
});
