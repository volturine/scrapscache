import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTOMATIC, type AppIconChoice } from '#lib/native/appIcon.js';

// The store with no iOS behind it: a choice shows at once, as it does in the app.
const store = vi.hoisted(() => ({
	supported: true,
	choice: null as unknown as AppIconChoice,
	error: '',
	choose: vi.fn()
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

afterEach(() => {
	store.error = '';
	store.choose.mockReset();
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

	it('starts a dark tile from the dark default, amber tilted notes', async () => {
		open();
		await fireEvent.click(radio('Tile', 'Dark'));
		expect(store.choose).toHaveBeenCalledWith({ tile: 'dark', notes: 'tilted', colour: 'amber' });
	});

	it('changes the notes and the colour of the icon it shows', async () => {
		open({ tile: 'dark', notes: 'tilted', colour: 'sky' });
		expect(screen.getByText('Sky · Tilted · Dark')).toBeTruthy();
		expect(radio('Colour', 'Sky').checked).toBe(true);

		await fireEvent.click(radio('Notes', 'Stacked'));
		expect(store.choose).toHaveBeenLastCalledWith({
			tile: 'dark',
			notes: 'stacked',
			colour: 'sky'
		});
		await fireEvent.click(radio('Colour', 'Mint'));
		expect(store.choose).toHaveBeenLastCalledWith({
			tile: 'dark',
			notes: 'tilted',
			colour: 'mint'
		});
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
