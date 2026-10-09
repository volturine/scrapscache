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

	it('flips the class and leaves the colours to the stylesheet without reading computed styles', () => {
		// app.html paints the first frame with these before any stylesheet loads.
		document.documentElement.style.backgroundColor = '#1a1a1a';
		document.documentElement.style.colorScheme = 'dark';
		document.body.style.backgroundColor = '#1a1a1a';
		const computed = vi.spyOn(window, 'getComputedStyle');

		uiStore.dark = true;

		expect(document.documentElement.classList.contains('dark')).toBe(true);
		expect(document.documentElement.style.backgroundColor).toBe('');
		expect(document.documentElement.style.colorScheme).toBe('');
		expect(document.body.style.backgroundColor).toBe('');
		expect(computed).not.toHaveBeenCalled();

		uiStore.dark = false;
		expect(document.documentElement.classList.contains('dark')).toBe(false);
	});
});
