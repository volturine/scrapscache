import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
	beforeEach(() => {
		// This element belongs to app.html and exists before the store boots.
		document.body.insertAdjacentHTML('afterbegin', '<div data-status-sample></div>');
	});

	afterEach(() => {
		uiStore.restoreState({ dark: null });
		document.documentElement.removeAttribute('style');
		document.body.removeAttribute('style');
		document.querySelector('[data-status-sample]')?.remove();
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
		expect(document.querySelector<HTMLElement>('[data-status-sample]')?.style.backgroundColor).toBe(
			'rgb(255, 255, 255)'
		);
		expect(computed).not.toHaveBeenCalled();

		uiStore.dark = true;
		expect(document.documentElement.classList.contains('dark')).toBe(true);
		expect(document.documentElement.style.backgroundColor).toBe('rgb(26, 26, 26)');
		expect(document.body.style.backgroundColor).toBe('rgb(26, 26, 26)');
		expect(document.querySelector<HTMLElement>('[data-status-sample]')?.style.backgroundColor).toBe(
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

describe('view switches', () => {
	afterEach(() => {
		uiStore.setView('notes');
	});

	it('start a new view with an empty search', () => {
		uiStore.setSearchInput('retro');

		uiStore.setView('archive');

		expect(uiStore.searchInput).toBe('');
		expect(uiStore.search).toBe('');
	});

	it('carry a query into the new view and filter by it at once', () => {
		vi.useFakeTimers();
		uiStore.setSearchInput('draft');

		uiStore.setView('trash', null, 'retro');

		// Committed before any timer runs: no debounce stands between the view and its filter.
		expect(uiStore.view).toBe('trash');
		expect(uiStore.searchInput).toBe('retro');
		expect(uiStore.search).toBe('retro');

		// The search typed before the switch never lands on the new view.
		vi.runAllTimers();
		vi.useRealTimers();
		expect(uiStore.search).toBe('retro');
	});
});

describe('reminder languages', () => {
	it('adds and removes languages but keeps the last one, and remembers them', async () => {
		const start = [...uiStore.reminderLanguages];
		for (const code of start.slice(1)) uiStore.toggleReminderLanguage(code);
		const [only] = uiStore.reminderLanguages;

		uiStore.toggleReminderLanguage(only);
		expect(uiStore.reminderLanguages).toEqual([only]);

		uiStore.toggleReminderLanguage(only === 'sk' ? 'en' : 'sk');
		expect(uiStore.reminderLanguages).toHaveLength(2);
		const saved = JSON.parse(localStorage.getItem('scrapscache-ui-state') ?? '{}');
		expect(saved.reminderLanguages).toEqual(uiStore.reminderLanguages);

		// A fresh store reads them back, dropping anything it cannot read.
		localStorage.setItem(
			'scrapscache-ui-state',
			JSON.stringify({ reminderLanguages: ['cs', 'xx', 'cs', 'de'] })
		);
		vi.resetModules();
		const { uiStore: fresh } = await import('./ui.svelte');
		expect(fresh.reminderLanguages).toEqual(['cs', 'de']);
	});
});

describe('text settings', () => {
	afterEach(() => {
		uiStore.textSize = 14;
		uiStore.codeSize = null;
		uiStore.codeWrap = false;
		localStorage.removeItem('scrapscache-ui-state');
	});

	it('scales the root by the text size and leaves it alone at the default', () => {
		const root = document.documentElement;

		uiStore.textSize = 21;
		expect(uiStore.textSize).toBe(20);
		expect(root.style.fontSize).toMatch(/^142\.857\d*%$/);

		uiStore.textSize = 11.6;
		expect(uiStore.textSize).toBe(12);

		uiStore.textSize = 14;
		expect(root.style.fontSize).toBe('');
	});

	it('gives code its own size only when one is set, and follows the text otherwise', () => {
		const root = document.documentElement;
		uiStore.textSize = 18;
		expect(uiStore.effectiveCodeSize).toBe(17);
		expect(root.style.getPropertyValue('--code-font-size')).toBe('');

		uiStore.codeSize = 9;
		expect(uiStore.codeSize).toBe(10);
		expect(uiStore.effectiveCodeSize).toBe(10);
		expect(root.style.getPropertyValue('--code-font-size')).toBe('10px');

		uiStore.codeSize = null;
		expect(root.style.getPropertyValue('--code-font-size')).toBe('');
	});

	it('marks the document while code wraps', () => {
		uiStore.codeWrap = true;
		expect(document.documentElement.hasAttribute('data-code-wrap')).toBe(true);
		uiStore.codeWrap = false;
		expect(document.documentElement.hasAttribute('data-code-wrap')).toBe(false);
	});

	it('keeps the settings on this device', () => {
		uiStore.textSize = 17;
		uiStore.codeSize = 12;
		uiStore.codeWrap = true;

		const saved = JSON.parse(localStorage.getItem('scrapscache-ui-state') ?? '{}');
		expect(saved).toMatchObject({ textSize: 17, codeSize: 12, codeWrap: true });
	});

	it('reads saved settings back, dropping sizes out of range or of the wrong kind', async () => {
		localStorage.setItem(
			'scrapscache-ui-state',
			JSON.stringify({ textSize: 40, codeSize: 'big', codeWrap: true })
		);
		const { UIStore } = await import('./ui.svelte');
		const store = new UIStore();

		expect(store.textSize).toBe(20);
		expect(store.codeSize).toBeNull();
		expect(store.codeWrap).toBe(true);
	});
});
