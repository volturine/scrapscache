import { expect, test } from '@playwright/test';

test('a first visit renders the starter notes with a clean console', async ({ page }) => {
	const errors: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	page.on('pageerror', (error) => errors.push(error.message));

	await page.goto('/');
	await expect(page.getByRole('button', { name: /^Open Welcome to Scraps Cache/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Open Groceries/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Open Reading list/ })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Pinned' })).toBeVisible();

	expect(errors).toEqual([]);
});

test('the shell is installable and the relay reports ready', async ({ page, request }) => {
	await page.goto('/');
	const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
	expect(manifestHref).toBeTruthy();
	const manifest = await request.get(manifestHref!);
	expect(manifest.ok()).toBe(true);
	expect((await manifest.json()).name).toContain('Scraps Cache');

	// The worker registers after the first paint, later still on a remote deployment.
	await page.waitForFunction(async () => Boolean(await navigator.serviceWorker.getRegistration()));

	const ready = await request.get('/health/ready');
	expect(ready.ok()).toBe(true);
	expect(await ready.json()).toEqual({ ready: true });
});

test('security headers and legal pages are served', async ({ request }) => {
	const home = await request.get('/');
	const headers = home.headers();
	expect(headers['content-security-policy']).toContain("default-src 'self'");
	expect(headers['referrer-policy']).toBe('no-referrer');
	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['permissions-policy']).toContain('camera=(self)');

	for (const path of ['/privacy', '/terms']) {
		const response = await request.get(path);
		expect(response.ok(), path).toBe(true);
	}
});
