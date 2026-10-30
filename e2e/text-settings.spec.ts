import { expect, test } from '@playwright/test';
import { openEmptyApp } from './app';

test('the text size scales the app, and it and code wrapping stay after a reload', async ({
	page
}) => {
	await openEmptyApp(page);
	const rootSize = () =>
		page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize));
	await expect.poll(rootSize).toBe(16);

	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Text and code' }).click();
	const dialog = page.getByRole('dialog', { name: 'Text and code' });
	const slider = dialog.getByRole('slider', { name: 'Text size' });
	await slider.focus();
	for (let step = 0; step < 4; step++) await page.keyboard.press('ArrowRight');
	await expect(slider).toHaveAttribute('aria-valuenow', '18');
	await dialog.getByText('Wrap long lines').click();

	// 18 px body text is 18/14 of the default, so the 16 px root grows with it.
	await expect.poll(rootSize).toBeCloseTo((16 * 18) / 14, 3);
	await expect(page.locator('html')).toHaveAttribute('data-code-wrap', '');

	await page.reload();
	await expect.poll(rootSize).toBeCloseTo((16 * 18) / 14, 3);
	await expect(page.locator('html')).toHaveAttribute('data-code-wrap', '');
});

test('a size slider rings its thumb for the keyboard, not after a press', async ({ page }) => {
	await openEmptyApp(page);
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Text and code' }).click();
	const dialog = page.getByRole('dialog', { name: 'Text and code' });
	const thumb = dialog.getByRole('slider', { name: 'Text size' });
	const ring = () => thumb.evaluate((element) => getComputedStyle(element).boxShadow);

	await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(thumb).toBeFocused();
	await expect.poll(ring).toContain('0px 0px 0px 3px');

	const track = await dialog
		.locator('[data-scope=slider][data-part=control]')
		.first()
		.boundingBox();
	await page.mouse.click(track!.x + track!.width * 0.8, track!.y + track!.height / 2);
	await expect(thumb).toBeFocused();
	await expect.poll(ring).not.toContain('0px 0px 0px 3px');
});
