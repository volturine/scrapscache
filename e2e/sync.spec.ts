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
	await dialog.getByRole('button', { name: 'Connect device' }).click();
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
