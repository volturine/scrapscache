import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uiStore } from '#lib/stores/ui.svelte.js';
import TextSettingsDialog from './TextSettingsDialog.svelte';

afterEach(() => {
	uiStore.textSize = 14;
	uiStore.codeSize = null;
	uiStore.codeWrap = false;
});

function open() {
	const onClose = vi.fn();
	render(TextSettingsDialog, { props: { onClose } });
	return { onClose };
}

describe('TextSettingsDialog', () => {
	it('moves the text size a step at a time from the keyboard, marking the default', async () => {
		open();
		const slider = screen.getByRole('slider', { name: 'Text size' });
		expect(slider.getAttribute('aria-valuenow')).toBe('14');
		expect(screen.getByText('14 px · Default')).toBeTruthy();

		slider.focus();
		await fireEvent.keyDown(slider, { key: 'ArrowRight' });
		await fireEvent.keyDown(slider, { key: 'ArrowRight' });

		expect(uiStore.textSize).toBe(16);
		expect(screen.getByText('16 px')).toBeTruthy();
	});

	it('gives code its own size from the size it was following, and follows again when off', async () => {
		uiStore.textSize = 18;
		open();
		expect(screen.queryByRole('slider', { name: 'Code size' })).toBeNull();

		await fireEvent.click(screen.getByRole('checkbox', { name: 'Own size for code' }));
		expect(uiStore.codeSize).toBe(17);
		const code = screen.getByRole('slider', { name: 'Code size' });
		code.focus();
		await fireEvent.keyDown(code, { key: 'ArrowLeft' });
		expect(uiStore.codeSize).toBe(16);

		await fireEvent.click(screen.getByRole('checkbox', { name: 'Own size for code' }));
		expect(uiStore.codeSize).toBeNull();
		expect(screen.queryByRole('slider', { name: 'Code size' })).toBeNull();
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
