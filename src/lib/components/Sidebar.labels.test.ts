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

function setup(labels: Label[]) {
	notesStore.notes = [];
	notesStore.labels = labels;
	const { container } = render(Sidebar, { props: {} });
	const section = container.querySelector('[data-labels-edit]') as HTMLElement;
	return { container, section };
}

afterEach(() => {
	vi.restoreAllMocks();
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

	it('opens context menu on right click on PC with Rename and Delete options', async () => {
		const { section } = setup([label('Work')]);
		const workBtn = section.querySelector('button[aria-label="Work"]') as HTMLButtonElement;

		// Right click on Work
		await fireEvent.contextMenu(workBtn, { clientX: 150, clientY: 200 });
		await tick();

		const menu = document.querySelector('[role="menu"][aria-label="Label options"]');
		expect(menu).toBeTruthy();
		expect(menu?.textContent).toContain('Rename');
		expect(menu?.textContent).toContain('Delete');
	});

	it('renames a label via PC context menu, committing on Enter and cancelling on Escape', async () => {
		const renameLabel = vi.spyOn(notesStore, 'renameLabel').mockImplementation(() => {});
		const { section } = setup([label('Work')]);
		const workBtn = section.querySelector('button[aria-label="Work"]') as HTMLButtonElement;

		// Open context menu
		await fireEvent.contextMenu(workBtn, { clientX: 100, clientY: 100 });
		await tick();

		// Click Rename
		const renameMenuBtn = Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) =>
			el.textContent?.includes('Rename')
		) as HTMLButtonElement;
		await fireEvent.click(renameMenuBtn);
		await tick();

		// Inline rename input is now visible
		let input = section.querySelector('input[aria-label="Rename Work"]') as HTMLInputElement;
		expect(input).toBeTruthy();

		// Edit and press Enter
		await fireEvent.input(input, { target: { value: 'Errands' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		await tick();
		expect(renameLabel).toHaveBeenCalledWith('work', 'Errands');

		// Rename again and cancel with Escape
		renameLabel.mockClear();
		const errandsBtn = section.querySelector('button[aria-label="Work"]') as HTMLButtonElement;
		await fireEvent.contextMenu(errandsBtn, { clientX: 100, clientY: 100 });
		await tick();

		const renameMenuBtn2 = Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) =>
			el.textContent?.includes('Rename')
		) as HTMLButtonElement;
		await fireEvent.click(renameMenuBtn2);
		await tick();

		input = section.querySelector('input[aria-label="Rename Work"]') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'Discarded' } });
		await fireEvent.keyDown(input, { key: 'Escape' });
		await tick();
		expect(renameLabel).not.toHaveBeenCalled();
		expect(section.querySelector('button[aria-label="Work"]')).toBeTruthy();
	});

	it('opens delete confirmation dialog from PC context menu Delete', async () => {
		const { section } = setup([label('Work')]);
		const workBtn = section.querySelector('button[aria-label="Work"]') as HTMLButtonElement;

		await fireEvent.contextMenu(workBtn, { clientX: 100, clientY: 100 });
		await tick();

		const deleteMenuBtn = Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) =>
			el.textContent?.includes('Delete')
		) as HTMLButtonElement;
		await fireEvent.click(deleteMenuBtn);
		await tick();

		// Delete dialog is opened
		const dialog = document.querySelector('[role="dialog"]');
		expect(dialog).toBeTruthy();
		expect(dialog?.textContent).toContain('Delete “Work”?');
	});

	it('reveals Rename and Delete actions on touch swipe and triggers them', async () => {
		const { section } = setup([label('Work')]);
		const workBtn = section.querySelector('button[aria-label="Work"]') as HTMLButtonElement;

		// Simulate swipe left
		await fireEvent.pointerDown(workBtn, {
			pointerId: 1,
			pointerType: 'touch',
			clientX: 200,
			clientY: 100
		});
		await fireEvent.pointerMove(workBtn, {
			pointerId: 1,
			pointerType: 'touch',
			clientX: 120,
			clientY: 100
		});
		await fireEvent.pointerUp(workBtn, {
			pointerId: 1,
			pointerType: 'touch',
			clientX: 120,
			clientY: 100
		});
		await tick();

		// The row is swiped open, revealing swipe action buttons
		const swipeRenameBtn = section.querySelector(
			'button[aria-label="Rename Work"]'
		) as HTMLButtonElement;
		const swipeDeleteBtn = section.querySelector(
			'button[aria-label="Delete Work"]'
		) as HTMLButtonElement;
		expect(swipeRenameBtn).toBeTruthy();
		expect(swipeDeleteBtn).toBeTruthy();

		// Clicking swipe delete opens confirmation dialog
		await fireEvent.click(swipeDeleteBtn);
		await tick();

		const dialog = document.querySelector('[role="dialog"]');
		expect(dialog).toBeTruthy();
		expect(dialog?.textContent).toContain('Delete “Work”?');
	});
});
