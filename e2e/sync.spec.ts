import { expect, test, type Page } from '@playwright/test';
import { createNote, noteCard, openEmptyApp, quickAction } from './app';

async function openSync(page: Page) {
	await page.getByRole('button', { name: /^Sync settings/ }).click();
	return page.getByRole('dialog');
}

// A deployed relay gates registration behind Turnstile, which no test can pass.
test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), 'registration needs Turnstile on a deployment');

test('two devices pair with a code and converge, deletes included', async ({ browser }) => {
	const contextA = await browser.newContext();
	const contextB = await browser.newContext();
	const a = await contextA.newPage();
	const b = await contextB.newPage();

	await openEmptyApp(a);
	await createNote(a, 'Shared plan', 'Written on the first device.');

	// Device A turns its workspace into a synced one.
	let dialog = await openSync(a);
	await dialog.getByRole('button', { name: /^Expand / }).click();
	await dialog.getByRole('button', { name: /^Sync this workspace/ }).click();
	await dialog.getByRole('button', { name: 'Start sync' }).click();
	await expect(dialog.getByRole('button', { name: / is active$/ })).toContainText('Synced');

	// Device A shows a one-time pairing code.
	await dialog.getByRole('button', { name: 'Connect another device' }).click();
	const codeBox = dialog.locator('[aria-label="One-time pairing code"]');
	await expect(codeBox).toBeVisible();
	const code = (await codeBox.innerText()).replace(/[^A-Za-z0-9]/g, '');
	expect(code).toHaveLength(16);

	// Device B joins with the code and receives the key and the notes.
	await openEmptyApp(b);
	const dialogB = await openSync(b);
	await dialogB.getByRole('button', { name: '+ New workspace' }).click();
	await dialogB.getByRole('button', { name: /^Join a synced workspace/ }).click();
	await dialogB.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(code);
	await dialogB.getByRole('button', { name: 'Start connection' }).click();
	await expect(dialogB.getByText('Paired and synced.')).toBeVisible({ timeout: 30_000 });
	await expect(dialog.getByText('Key sent. This device can go offline.')).toBeVisible();
	await dialog.getByRole('button', { name: 'Close' }).click();
	await dialogB.getByRole('button', { name: 'Close' }).click();
	await expect(noteCard(b, 'Shared plan')).toBeVisible();

	// An edit on B reaches A.
	await createNote(b, 'Second device note');
	dialog = await openSync(a);
	await dialog.getByRole('button', { name: 'Sync now' }).click();
	await dialog.getByRole('button', { name: 'Close' }).click();
	await expect(noteCard(a, 'Second device note')).toBeVisible({ timeout: 30_000 });

	// A delete on A tombstones the note on B.
	await quickAction(noteCard(a, 'Shared plan'), 'Delete note');
	await expect(noteCard(a, 'Shared plan')).toBeHidden();
	dialog = await openSync(b);
	await dialog.getByRole('button', { name: 'Sync now' }).click();
	await dialog.getByRole('button', { name: 'Close' }).click();
	await expect(noteCard(b, 'Shared plan')).toBeHidden({ timeout: 30_000 });
	await b.goto('/trash');
	await expect(noteCard(b, 'Shared plan')).toBeVisible();

	await contextA.close();
	await contextB.close();
});

test('sync speaks up above the feed only when it needs attention', async ({ page, context }) => {
	await openEmptyApp(page);
	await createNote(page, 'Quiet note');
	const banner = page.locator('[data-sync-attention]');
	// A workspace that only lives on this device has nothing to say.
	await expect(banner).toHaveCount(0);

	let dialog = await openSync(page);
	await dialog.getByRole('button', { name: /^Expand / }).click();
	await dialog.getByRole('button', { name: /^Sync this workspace/ }).click();
	await dialog.getByRole('button', { name: 'Start sync' }).click();
	await expect(dialog.getByRole('button', { name: / is active$/ })).toContainText('Synced');
	await dialog.getByRole('button', { name: 'Close' }).click();
	// Synced and quiet: still nothing.
	await expect(banner).toHaveCount(0);

	// A sync that cannot reach the relay is worth a banner, with the next step on it.
	await context.setOffline(true);
	dialog = await openSync(page);
	await dialog.getByRole('button', { name: 'Sync now' }).click();
	await expect(dialog.getByText('Could not reach server. Check your connection.')).toBeVisible();
	await dialog.getByRole('button', { name: 'Close' }).click();
	await expect(banner).toHaveAttribute('data-sync-attention', 'error');
	await expect(banner).toContainText('Sync stopped: the server could not be reached.');
	await expect(banner).toContainText('Your notes are safe on this device.');

	// Retry once the connection is back clears it.
	await context.setOffline(false);
	await banner.getByRole('button', { name: 'Retry' }).click();
	await expect(banner).toHaveCount(0);
});
