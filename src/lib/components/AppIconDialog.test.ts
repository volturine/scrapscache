import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTOMATIC, masterName, type AppIconChoice } from '#lib/native/appIcon.js';

// The store with no iOS behind it: it shows `choice`, and records what is applied.
const store = vi.hoisted(() => ({
	supported: true,
	choice: null as unknown as AppIconChoice,
	applying: false,
	error: '',
	isShowing: (choice: AppIconChoice) => masterName(choice) === masterName(store.choice),
	apply: vi.fn()
}));
vi.mock('#lib/stores/appIcon.svelte.js', () => ({ appIconStore: store }));

const { default: AppIconDialog } = await import('./AppIconDialog.svelte');

function open(choice: AppIconChoice = AUTOMATIC) {
	store.choice = choice;
	const onClose = vi.fn();
	render(AppIconDialog, { props: { onClose } });
	return { onClose };
}

const group = (name: string) => screen.getByRole('radiogroup', { name });
const radio = (groupName: string, name: string) =>
	within(group(groupName)).getByRole('radio', { name }) as HTMLInputElement;
const applyButton = () =>
	screen.getByRole('button', { name: /^(Apply|Current icon|Applying…)$/ }) as HTMLButtonElement;

afterEach(() => {
	store.applying = false;
	store.error = '';
	store.apply.mockReset();
});

describe('AppIconDialog', () => {
	it('is a dialog named App icon, with the tile, the notes and the colour to choose', () => {
		open();
		expect(screen.getByRole('dialog', { name: 'App icon' })).toBeTruthy();
		for (const name of ['Tile', 'Notes', 'Colour']) expect(group(name)).toBeTruthy();
		expect(radio('Tile', 'Automatic').checked).toBe(true);
	});

	it('leaves the notes and colour to Automatic, which shows the light and dark pair', () => {
		open();
		expect(radio('Notes', 'Stacked').disabled).toBe(true);
		expect(radio('Colour', 'Mint').disabled).toBe(true);
		expect(screen.getByText('Peach in light mode, amber in dark mode')).toBeTruthy();
	});

	it('names the icon iOS shows on a button that does nothing', () => {
		open({ tile: 'dark', notes: 'tilted', colour: 'sky' });
		expect(applyButton().textContent?.trim()).toBe('Current icon');
		expect(applyButton().disabled).toBe(true);
	});

	it('builds the icon in the preview, changing nothing until Apply', async () => {
		open();
		await fireEvent.click(radio('Tile', 'Dark'));
		expect(screen.getByText('Amber · Tilted · Dark')).toBeTruthy();
		await fireEvent.click(radio('Notes', 'Stacked'));
		await fireEvent.click(radio('Colour', 'Mint'));
		expect(screen.getByText('Mint · Stacked · Dark')).toBeTruthy();
		expect(store.apply).not.toHaveBeenCalled();

		expect(applyButton().textContent?.trim()).toBe('Apply');
		await fireEvent.click(applyButton());
		expect(store.apply).toHaveBeenCalledOnce();
		expect(store.apply).toHaveBeenCalledWith({ tile: 'dark', notes: 'stacked', colour: 'mint' });
	});

	it('goes back to Automatic with Apply, from an alternate', async () => {
		open({ tile: 'light', notes: 'stacked', colour: 'pink' });
		await fireEvent.click(radio('Tile', 'Automatic'));
		await fireEvent.click(applyButton());
		expect(store.apply).toHaveBeenCalledWith(AUTOMATIC);
	});

	it('waits on iOS while it applies', async () => {
		store.applying = true;
		open();
		await fireEvent.click(radio('Tile', 'Dark'));
		expect(applyButton().textContent?.trim()).toBe('Applying…');
		expect(applyButton().disabled).toBe(true);
	});

	it('offers amber on dark tiles only', () => {
		open({ tile: 'light', notes: 'tilted', colour: 'peach' });
		const colours = within(group('Colour')).getAllByRole('radio');
		expect(colours.map((colour) => colour.getAttribute('value'))).toEqual([
			'sky',
			'mint',
			'pink',
			'peach'
		]);
	});

	it('says when iOS kept the old icon', () => {
		store.error = 'The icon did not change. Try again.';
		open();
		expect(screen.getByRole('alert').textContent).toBe('The icon did not change. Try again.');
	});

	it('closes from its close button', async () => {
		const { onClose } = open();
		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(onClose).toHaveBeenCalledOnce();
	});
});
