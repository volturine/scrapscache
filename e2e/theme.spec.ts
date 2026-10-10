import { expect, test } from '@playwright/test';
import { createNote, openEmptyApp } from './app';

type ThemeSwitchProbeWindow = Window & {
	__themeSwitchProbe?: {
		classActive: boolean;
		settingsTransitionDuration: string | null;
		cardTransitionDuration: string | null;
	};
};

test('theme changes do not animate every control', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Theme sample note');

	await page.evaluate(() => {
		const root = document.documentElement;
		const probeWindow = window as ThemeSwitchProbeWindow;
		probeWindow.__themeSwitchProbe = undefined;
		const observer = new MutationObserver(() => {
			if (!root.classList.contains('theme-switching')) return;
			const settings = document.querySelector<HTMLElement>('button[aria-label="Settings"]');
			const card = document.querySelector<HTMLElement>('article');
			probeWindow.__themeSwitchProbe = {
				classActive: true,
				settingsTransitionDuration: settings ? getComputedStyle(settings).transitionDuration : null,
				cardTransitionDuration: card ? getComputedStyle(card).transitionDuration : null
			};
			observer.disconnect();
		});
		observer.observe(root, { attributes: true, attributeFilter: ['class'] });
	});

	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('menuitem', { name: /^(Dark|Light) mode$/ }).click();

	await expect
		.poll(() => page.evaluate(() => (window as ThemeSwitchProbeWindow).__themeSwitchProbe ?? null))
		.toEqual({
			classActive: true,
			settingsTransitionDuration: '0s',
			cardTransitionDuration: '0s'
		});

	await expect
		.poll(() => page.evaluate(() => document.documentElement.classList.contains('theme-switching')))
		.toBe(false);
	const restoredTransitions = await page.evaluate(() => ({
		settings: getComputedStyle(document.querySelector('button[aria-label="Settings"]')!)
			.transitionDuration,
		card: getComputedStyle(document.querySelector('article')!).transitionDuration
	}));
	expect(restoredTransitions.settings).not.toBe('0s');
	expect(restoredTransitions.card).not.toBe('0s');
});
