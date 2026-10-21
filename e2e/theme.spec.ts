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
	await page.getByRole('menuitemradio', { name: 'Dark' }).click();

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

test.describe('installed iOS document chrome', () => {
	test.use({
		viewport: { width: 393, height: 852 },
		userAgent:
			'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
		isMobile: true,
		hasTouch: true
	});

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'standalone', { value: true });
			localStorage.setItem('scrapscache-ui-state', JSON.stringify({ dark: true }));
		});
	});

	test('paints the status sampler before the application loads', async ({ page }) => {
		await page.route('**/*.js', (route) => route.abort());
		await page.goto('/');

		await expect(page.locator('[data-status-sample]')).toHaveCount(1);
		await expect(page.locator('[data-status-sample]')).toHaveCSS(
			'background-color',
			'rgb(26, 26, 26)'
		);
		await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveCount(0);
	});

	test('keeps an opaque sample at the top edge through theme switches and overlays', async ({
		page
	}) => {
		await openEmptyApp(page);
		const sample = page.locator('[data-status-sample]');
		const samplingGeometry = await page.evaluate(() => {
			const sample = document.querySelector<HTMLElement>('[data-status-sample]')!;
			const bounds = sample.getBoundingClientRect();
			return {
				top: bounds.top,
				width: bounds.width,
				height: bounds.height,
				viewportWidth: window.innerWidth,
				appTop: document.querySelector('.app-viewport')!.getBoundingClientRect().top,
				sampled: document.elementFromPoint(window.innerWidth / 2, 4) === sample,
				backdropFilter: getComputedStyle(sample).backdropFilter
			};
		});
		expect(samplingGeometry.top).toBe(0);
		expect(samplingGeometry.width).toBe(samplingGeometry.viewportWidth);
		expect(samplingGeometry.height).toBeGreaterThan(10);
		expect(samplingGeometry.appTop).toBe(samplingGeometry.height);
		expect(samplingGeometry.sampled).toBe(true);
		expect(samplingGeometry.backdropFilter).toBe('none');

		// A phone has the More menu, which holds the settings.
		await page.getByRole('button', { name: 'More', exact: true }).click();
		for (const [name, color] of [
			['Light', 'rgb(255, 255, 255)'],
			['Dark', 'rgb(26, 26, 26)']
		]) {
			await page.getByRole('menuitemradio', { name, exact: true }).click();
			await expect(sample).toHaveCSS('background-color', color);
			await expect(page.locator('html')).toHaveCSS('background-color', color);
		}
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu', { includeHidden: true })).toBeHidden();

		await page.getByRole('button', { name: 'New note' }).click();
		await expect(page.getByRole('dialog', { name: 'Note editor' })).toBeVisible();
		expect(
			await page.evaluate(() =>
				document.elementFromPoint(window.innerWidth / 2, 4)?.hasAttribute('data-status-sample')
			)
		).toBe(true);
	});
});
