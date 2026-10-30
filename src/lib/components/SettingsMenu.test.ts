import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uiStore } from '#lib/stores/ui.svelte.js';
import SettingsMenu from './SettingsMenu.svelte';

async function openMenu(props: Partial<{ importing: boolean; importError: string }> = {}) {
	const onExport = vi.fn();
	const onImport = vi.fn();
	const onTextSettings = vi.fn();
	render(SettingsMenu, { props: { onExport, onImport, onTextSettings, ...props } });
	await fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
	return { onExport, onImport, onTextSettings };
}

async function choose(item: HTMLElement) {
	await fireEvent.pointerDown(item, { pointerType: 'mouse' });
	await fireEvent.click(item);
}

afterEach(() => {
	uiStore.dark = null;
	uiStore.layout = 'grid';
	uiStore.textSize = 14;
	uiStore.codeWrap = false;
});

describe('SettingsMenu', () => {
	it('groups its items under Appearance, Data on this device and About', async () => {
		await openMenu();

		for (const name of ['Appearance', 'Data on this device', 'About']) {
			expect(screen.getByRole('group', { name })).toBeTruthy();
		}
		const data = screen.getByRole('group', { name: 'Data on this device' });
		expect(within(data).getByRole('menuitem', { name: 'Back up notes…' })).toBeTruthy();
		expect(within(data).getByRole('menuitem', { name: 'Restore from a backup…' })).toBeTruthy();
		const about = screen.getByRole('group', { name: 'About' });
		expect(within(about).getByRole('menuitem', { name: 'Report an issue' })).toBeTruthy();
		expect(within(about).getByRole('menuitem', { name: 'Privacy' })).toBeTruthy();
		expect(within(about).getByRole('menuitem', { name: 'Terms' })).toBeTruthy();
	});

	it('offers the theme as System, Light and Dark, with System following the device', async () => {
		await openMenu();
		const theme = screen.getByRole('group', { name: 'Theme' });
		const radios = within(theme).getAllByRole('menuitemradio');
		expect(radios.map((radio) => radio.textContent?.trim())).toEqual(['System', 'Light', 'Dark']);
		expect(radios[0].getAttribute('aria-checked')).toBe('true');

		await choose(radios[2]);
		expect(uiStore.dark).toBe(true);
		expect(radios[2].getAttribute('aria-checked')).toBe('true');

		await choose(radios[1]);
		expect(uiStore.dark).toBe(false);

		// Back to the device's choice, which the old toggle could never do.
		await choose(radios[0]);
		expect(uiStore.dark).toBeNull();
	});

	it('moves the layout choice into the menu', async () => {
		await openMenu();
		const layout = screen.getByRole('group', { name: 'Layout' });

		await choose(within(layout).getByRole('menuitemradio', { name: 'List' }));
		expect(uiStore.layout).toBe('list');
		await choose(within(layout).getByRole('menuitemradio', { name: 'Grid' }));
		expect(uiStore.layout).toBe('grid');
	});

	it('opens Text and code from Appearance, naming the size and the wrap', async () => {
		uiStore.textSize = 16;
		uiStore.codeWrap = true;
		const { onTextSettings } = await openMenu();
		const appearance = screen.getByRole('group', { name: 'Appearance' });
		const item = within(appearance).getByRole('menuitem', { name: 'Text and code' });

		expect(item.getAttribute('aria-describedby')).toBeTruthy();
		expect(item.textContent).toContain('16 px text · code wraps');
		await choose(item);
		expect(onTextSettings).toHaveBeenCalledOnce();
	});

	it('runs the backup actions it is given, and disables restore while one runs', async () => {
		const { onExport, onImport } = await openMenu();

		await choose(screen.getByRole('menuitem', { name: 'Back up notes…' }));
		expect(onExport).toHaveBeenCalledOnce();
		await choose(screen.getByRole('menuitem', { name: 'Restore from a backup…' }));
		expect(onImport).toHaveBeenCalledOnce();
	});

	it('shows an import error under the sections', async () => {
		await openMenu({ importing: true, importError: 'That file is not a backup.' });

		expect(screen.getByRole('alert').textContent).toContain('That file is not a backup.');
		expect(
			screen.getByRole('menuitem', { name: 'Restore from a backup…' }).getAttribute('aria-disabled')
		).toBe('true');
	});
});
