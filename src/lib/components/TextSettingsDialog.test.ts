import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uiStore } from '#lib/stores/ui.svelte.js';
import TextSettingsDialog from './TextSettingsDialog.svelte';

afterEach(() => {
	uiStore.textSize = 14;
	uiStore.titleSize = 15;
	uiStore.codeSize = 13;
	uiStore.codeWrap = false;
});

function open() {
	const onClose = vi.fn();
	render(TextSettingsDialog, { props: { onClose } });
	return { onClose };
}

describe('TextSettingsDialog', () => {
	it('moves the app text a step at a time from the keyboard, marking the default', async () => {
		open();
		const slider = screen.getByRole('slider', { name: 'App text' });
		expect(slider.getAttribute('aria-valuenow')).toBe('14');
		expect(screen.getByText('14 px · Default')).toBeTruthy();

		slider.focus();
		await fireEvent.keyDown(slider, { key: 'ArrowRight' });
		await fireEvent.keyDown(slider, { key: 'ArrowRight' });

		expect(uiStore.textSize).toBe(16);
		expect(screen.getByText('16 px')).toBeTruthy();
	});

	it('sizes note titles and code on sliders of their own, leaving the app text', async () => {
		open();
		const titles = screen.getByRole('slider', { name: 'Note titles' });
		expect(titles.getAttribute('aria-valuenow')).toBe('15');
		titles.focus();
		await fireEvent.keyDown(titles, { key: 'ArrowRight' });
		expect(uiStore.titleSize).toBe(16);

		const code = screen.getByRole('slider', { name: 'Code size' });
		expect(code.getAttribute('aria-valuenow')).toBe('13');
		code.focus();
		await fireEvent.keyDown(code, { key: 'ArrowLeft' });
		expect(uiStore.codeSize).toBe(12);
		expect(uiStore.textSize).toBe(14);
	});

	it('wraps long code lines when asked', async () => {
		open();
		const wrap = screen.getByRole('checkbox', { name: 'Wrap long lines' });
		expect((wrap as HTMLInputElement).checked).toBe(false);

		await fireEvent.click(wrap);
		expect(uiStore.codeWrap).toBe(true);
	});

	it('is a dialog named by its title, closed from its close button', async () => {
		const { onClose } = open();
		expect(screen.getByRole('dialog', { name: 'Text and code' })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(onClose).toHaveBeenCalledOnce();
	});
});
