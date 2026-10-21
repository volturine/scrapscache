import { expect, test } from '@playwright/test';

// A deployment serves the dashboard from its own Worker and host, not the app's.
test.skip(
	Boolean(process.env.PLAYWRIGHT_BASE_URL),
	'the dashboard has its own host on a deployment'
);

test('the operator dashboard is served as its own build, under its own policy', async ({
	page
}) => {
	const problems: string[] = [];
	page.on('console', (message) => {
		// The page asks the admin API first, and this server has no admin token or
		// Access configured, so that request is refused with a 404 by design.
		if (message.type() === 'error' && !message.text().includes('404'))
			problems.push(message.text());
	});
	page.on('pageerror', (error) => problems.push(error.message));

	const response = await page.goto('/admin');
	expect(page.url()).toMatch(/\/admin\/$/);
	expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
	expect(response?.headers()['cache-control']).toBe('no-store');

	// Refused without a credential, the page offers the token form, with no error shown.
	await expect(page.getByLabel('Admin token')).toBeVisible();
	await expect(page.getByRole('alert')).toHaveCount(0);
	// Styles and fonts came from the build, not the notes app.
	await expect(page.getByRole('heading', { name: 'Operations' })).toHaveCSS(
		'font-family',
		/Google Sans/
	);

	expect(problems).toEqual([]);
});
