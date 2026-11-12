import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uiStore } from '#lib/stores/ui.svelte.js';
import SettingsMenu from './SettingsMenu.svelte';

const native = vi.hoisted(() => ({ app: false }));
vi.mock('#lib/native.js', () => ({ isNativeApp: () => native.app }));

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
	native.app = false;
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
		expect(within(about).getByRole('menuitem', { name: 'Support' }).getAttribute('href')).toMatch(
			/\/support$/
		);
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

	it('opens again with the server row collapsed, so no field takes the keyboard', async () => {
		native.app = true;
		await openMenu();
		const server = screen.getByRole('menuitem', { name: 'Server' });
		// The host alone ends the line; a full stop after it reads as part of the address.
		expect(server.textContent).toContain('Syncs with scrapscache.com');
		expect(server.textContent?.trimEnd().endsWith('.')).toBe(false);
		await choose(server);
		expect(screen.getByRole('textbox', { name: 'Server address' })).toBeTruthy();

		const trigger = screen.getByRole('button', { name: 'Settings' });
		await fireEvent.click(trigger);
		await fireEvent.click(trigger);

		expect(screen.getByRole('menuitem', { name: 'Server' }).getAttribute('aria-expanded')).toBe(
			'false'
		);
		expect(screen.queryByRole('textbox', { name: 'Server address' })).toBeNull();
		await new Promise((resolve) => requestAnimationFrame(resolve));
		expect(document.activeElement?.tagName).not.toBe('INPUT');
	});

	it('scrolls the focused address above the keys when they come up', async () => {
		native.app = true;
		const viewport = Object.assign(new EventTarget(), { offsetTop: 0, height: 800 });
		Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
		try {
			await openMenu();
			await choose(screen.getByRole('menuitem', { name: 'Server' }));
			const field = screen.getByRole('textbox', { name: 'Server address' });
			const menu = field.closest<HTMLElement>('[role="menu"]')!;
			const rect = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;
			// The field sits inside the menu, under where the keys will reach.
			vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(rect(0, 700));
			vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(rect(600, 650));
			field.focus();
			expect(menu.scrollTop).toBe(0);

			viewport.height = 400;
			viewport.dispatchEvent(new Event('resize'));
			await new Promise((resolve) => requestAnimationFrame(resolve));

			expect(menu.scrollTop).toBe(250);
		} finally {
			Reflect.deleteProperty(window, 'visualViewport');
		}
	});
});
