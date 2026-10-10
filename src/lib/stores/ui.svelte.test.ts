import { afterEach, describe, expect, it, vi } from 'vitest';
import { uiStore } from './ui.svelte';

describe('ui store persistence', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		uiStore.restoreState({ dark: null, layout: 'grid', view: 'notes' });
	});

	it('keeps a backup restore going when localStorage is full', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
		});
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		expect(() => uiStore.restoreState({ dark: true, layout: 'list' })).not.toThrow();

		expect(uiStore.dark).toBe(true);
		expect(uiStore.layout).toBe('list');
	});

	it('does not hide a localStorage failure that is not about space', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('Access is denied for this document.', 'SecurityError');
		});

		expect(() => uiStore.restoreState({ layout: 'list' })).toThrow('Access is denied');
	});
});

describe('theme switch', () => {
	afterEach(() => {
		uiStore.restoreState({ dark: null });
		document.documentElement.removeAttribute('style');
		document.body.removeAttribute('style');
	});

	it('flips the class and paints a concrete document background without reading computed styles', () => {
		// app.html paints the first frame with these before any stylesheet loads.
		document.documentElement.style.backgroundColor = '#1a1a1a';
		document.documentElement.style.colorScheme = 'dark';
		document.body.style.backgroundColor = '#1a1a1a';
		const computed = vi.spyOn(window, 'getComputedStyle');

		uiStore.dark = false;

		expect(document.documentElement.classList.contains('dark')).toBe(false);
		expect(document.documentElement.style.backgroundColor).toBe('rgb(255, 255, 255)');
		expect(document.documentElement.style.colorScheme).toBe('light');
		expect(document.body.style.backgroundColor).toBe('rgb(255, 255, 255)');
		expect(document.querySelector('[data-status-sample]')?.style.backgroundColor).toBe(
			'rgb(255, 255, 255)'
		);
		expect(computed).not.toHaveBeenCalled();

		uiStore.dark = true;
		expect(document.documentElement.classList.contains('dark')).toBe(true);
		expect(document.documentElement.style.backgroundColor).toBe('rgb(26, 26, 26)');
		expect(document.body.style.backgroundColor).toBe('rgb(26, 26, 26)');
		expect(document.querySelector('[data-status-sample]')?.style.backgroundColor).toBe(
			'rgb(26, 26, 26)'
		);
	});

	it('holds transitions off for the frame that paints the new colours', () => {
		vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
		try {
			const root = document.documentElement;

			uiStore.dark = true;
			expect(root.classList.contains('theme-switching')).toBe(true);

			// The first frame computes the new colours with transitions disabled.
			vi.advanceTimersToNextFrame();
			expect(root.classList.contains('theme-switching')).toBe(true);
			// The second frame changes no colour, so restoring them starts nothing.
			vi.advanceTimersToNextFrame();
			expect(root.classList.contains('theme-switching')).toBe(false);

			// A second switch inside the window restarts it rather than ending early.
			uiStore.dark = false;
			vi.advanceTimersToNextFrame();
			uiStore.dark = true;
			vi.advanceTimersToNextFrame();
			expect(root.classList.contains('theme-switching')).toBe(true);
			vi.advanceTimersToNextFrame();
			expect(root.classList.contains('theme-switching')).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
});
