import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';

const navigationMocks = vi.hoisted(() => ({ goto: vi.fn().mockResolvedValue(undefined) }));
vi.mock('$app/navigation', () => navigationMocks);
import Sidebar from './Sidebar.svelte';
import { notesStore } from '$lib/stores/notes.svelte';
import type { Label } from '$lib/types';

function label(name: string, id = name.toLowerCase()): Label {
	return { id, name, createdAt: 1, updatedAt: 1 };
}

async function pointer(target: Element, type: string, clientX: number, clientY = 100) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.assign(event, { pointerType: 'touch', pointerId: 1, button: 0, clientX, clientY });
	await fireEvent(target, event);
}

function setup(labels: Label[]) {
	notesStore.notes = [];
	notesStore.labels = labels;
	const { container } = render(Sidebar, { props: {} });
	const section = container.querySelector('[data-labels-edit]') as HTMLElement;
	return { container, section };
}

afterEach(() => {
	vi.restoreAllMocks();
	navigationMocks.goto.mockClear();
});

describe('Sidebar labels section', () => {
	it('renders search input and filters labels by query', async () => {
		const { section } = setup([label('Work'), label('Personal'), label('Ideas')]);

		const searchInput = section.querySelector(
			'input[aria-label="Search or create a label"]'
		) as HTMLInputElement;
		expect(searchInput).toBeTruthy();
		expect(searchInput.placeholder).toBe('Search or create a label…');

		// All 3 visible initially
		expect(section.querySelector('button[aria-label="Work"]')).toBeTruthy();
		expect(section.querySelector('button[aria-label="Personal"]')).toBeTruthy();
		expect(section.querySelector('button[aria-label="Ideas"]')).toBeTruthy();

		// Filter for "per"
		await fireEvent.input(searchInput, { target: { value: 'per' } });
		await tick();

		expect(section.querySelector('button[aria-label="Work"]')).toBeNull();
		expect(section.querySelector('button[aria-label="Personal"]')).toBeTruthy();
		expect(section.querySelector('button[aria-label="Ideas"]')).toBeNull();
	});

	it('offers a create button when query does not match an existing label and creates on Enter or click', async () => {
		const createLabel = vi.spyOn(notesStore, 'createLabel').mockReturnValue(label('Projects'));
		const { section } = setup([label('Work')]);

		const searchInput = section.querySelector(
			'input[aria-label="Search or create a label"]'
		) as HTMLInputElement;

		// When matching existing, no create button
		await fireEvent.input(searchInput, { target: { value: 'work' } });
		await tick();
		expect(section.querySelector('button[aria-label=\'Create "work"\']')).toBeNull();

		// When not matching existing, create button appears
		await fireEvent.input(searchInput, { target: { value: 'Projects' } });
		await tick();
		const createBtn = section.querySelector(
			'button[aria-label=\'Create "Projects"\']'
		) as HTMLButtonElement;
		expect(createBtn).toBeTruthy();
		expect(createBtn.textContent).toContain('Create “Projects”');

		// Click to create
		await fireEvent.click(createBtn);
		await tick();
		expect(createLabel).toHaveBeenCalledWith('Projects');

		// Press Enter in search input to create
		createLabel.mockClear();
		await fireEvent.input(searchInput, { target: { value: 'Fitness' } });
		await tick();
		await fireEvent.keyDown(searchInput, { key: 'Enter' });
		await tick();
		expect(createLabel).toHaveBeenCalledWith('Fitness');
	});

	it('clears query on Escape key in search input', async () => {
		const { section } = setup([label('Work')]);
		const searchInput = section.querySelector(
			'input[aria-label="Search or create a label"]'
		) as HTMLInputElement;

		await fireEvent.input(searchInput, { target: { value: 'something' } });
		await tick();
		expect(searchInput.value).toBe('something');

		await fireEvent.keyDown(searchInput, { key: 'Escape' });
		await tick();
		expect(searchInput.value).toBe('');
	});

	it('opens the same haze overlay on a left swipe, without navigating', async () => {
		const { section } = setup([label('Work')]);
		const workBtn = section.querySelector('button[aria-label="Work"]') as HTMLButtonElement;

		await pointer(workBtn, 'pointerdown', 200);
		await pointer(workBtn, 'pointermove', 160);
		await pointer(workBtn, 'pointermove', 120);
		await pointer(workBtn, 'pointerup', 120);
		await tick();

		expect(section.querySelector('[data-label-haze]')).toBeTruthy();
		expect(section.querySelector('button[aria-label="Rename Work"]')).toBeTruthy();

		// The release that opened the actions must not also open the label.
		await fireEvent.click(workBtn);
		await tick();
		expect(navigationMocks.goto).not.toHaveBeenCalled();
	});

	it('opens haze overlay on right click with small Rename and Delete icon buttons', async () => {
		const { section } = setup([label('Work')]);
		const workBtn = section.querySelector('button[aria-label="Work"]') as HTMLButtonElement;

		// Initially no haze overlay
		expect(section.querySelector('[data-label-haze]')).toBeNull();

		// Right click on Work
		await fireEvent.contextMenu(workBtn);
		await tick();

		const haze = section.querySelector('[data-label-haze]');
		expect(haze).toBeTruthy();

		const renameBtn = section.querySelector(
			'button[aria-label="Rename Work"]'
		) as HTMLButtonElement;
		const deleteBtn = section.querySelector(
			'button[aria-label="Delete Work"]'
		) as HTMLButtonElement;
		expect(renameBtn).toBeTruthy();
		expect(deleteBtn).toBeTruthy();
	});

	it('renames a label via right-click haze overlay, committing on Enter and cancelling on Escape', async () => {
		const renameLabel = vi.spyOn(notesStore, 'renameLabel').mockImplementation(() => {});
		const { section } = setup([label('Work')]);
		const workBtn = section.querySelector('button[aria-label="Work"]') as HTMLButtonElement;

		// Open haze overlay
		await fireEvent.contextMenu(workBtn);
		await tick();

		// Click Rename icon button
		const renameBtn = section.querySelector(
			'button[aria-label="Rename Work"]'
		) as HTMLButtonElement;
		await fireEvent.click(renameBtn);
		await tick();

		// Inline rename input is now visible
		const input = section.querySelector('input[aria-label="Rename Work"]') as HTMLInputElement;
		expect(input).toBeTruthy();

		// Edit and press Enter
		await fireEvent.input(input, { target: { value: 'Errands' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		await tick();
		expect(renameLabel).toHaveBeenCalledWith('work', 'Errands');

		// Rename again and cancel with Escape
		renameLabel.mockClear();
		const errandsBtn = section.querySelector('button[aria-label="Work"]') as HTMLButtonElement;
		await fireEvent.contextMenu(errandsBtn);
		await tick();

		const renameBtn2 = section.querySelector(
			'button[aria-label="Rename Work"]'
		) as HTMLButtonElement;
		await fireEvent.click(renameBtn2);
		await tick();

		const input2 = section.querySelector('input[aria-label="Rename Work"]') as HTMLInputElement;
		await fireEvent.input(input2, { target: { value: 'Shopping' } });
		await fireEvent.keyDown(input2, { key: 'Escape' });
		await tick();
		expect(renameLabel).not.toHaveBeenCalled();
	});

	it('deletes a label via right-click haze overlay', async () => {
		const removeLabel = vi.spyOn(notesStore, 'removeLabel').mockImplementation(() => {});
		const { section } = setup([label('Work')]);
		const workBtn = section.querySelector('button[aria-label="Work"]') as HTMLButtonElement;

		// Open haze overlay
		await fireEvent.contextMenu(workBtn);
		await tick();

		// Click Delete icon button
		const deleteBtn = section.querySelector(
			'button[aria-label="Delete Work"]'
		) as HTMLButtonElement;
		await fireEvent.click(deleteBtn);
		await tick();

		// Dialog should be open
		const dialogContent = document.querySelector('[role="dialog"]');
		expect(dialogContent).toBeTruthy();
		expect(dialogContent?.textContent).toContain('Delete label');

		// Click 'Delete label only'
		const confirmBtn = Array.from(document.querySelectorAll('button')).find((el) =>
			el.textContent?.includes('Delete label only')
		) as HTMLButtonElement;
		expect(confirmBtn).toBeTruthy();
		await fireEvent.click(confirmBtn);
		await tick();

		expect(removeLabel).toHaveBeenCalledWith('work', { deleteNotes: false });
	});

	it('dismisses haze overlay on Escape key or outside click', async () => {
		const { section } = setup([label('Work')]);
		const workBtn = section.querySelector('button[aria-label="Work"]') as HTMLButtonElement;

		// Open haze overlay
		await fireEvent.contextMenu(workBtn);
		await tick();
		expect(section.querySelector('[data-label-haze]')).toBeTruthy();

		// Press Escape
		await fireEvent.keyDown(window, { key: 'Escape' });
		await tick();
		expect(section.querySelector('[data-label-haze]')).toBeNull();

		// Open again and click outside
		await fireEvent.contextMenu(workBtn);
		await tick();
		expect(section.querySelector('[data-label-haze]')).toBeTruthy();

		await fireEvent.pointerDown(document.body);
		await tick();
		expect(section.querySelector('[data-label-haze]')).toBeNull();
	});
});
