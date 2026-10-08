import { expect, test } from '@playwright/test';
import { createNote, noteCard, openEmptyApp } from './app';

const passphrase = 'correct horse battery staple';

test('an encrypted backup restores the notes into a fresh browser', async ({
	browser
}, testInfo) => {
	const source = await browser.newContext();
	const page = await source.newPage();
	await openEmptyApp(page);
	await createNote(page, 'Backed up', 'Keep this safe.');

	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Export backup' }).click();
	const dialog = page.getByRole('dialog').filter({ hasText: 'Protect this backup' });
	await dialog.getByLabel('Backup passphrase').fill(passphrase);
	await dialog.getByLabel('Confirm passphrase').fill(passphrase);
	const downloadPromise = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export backup' }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/^scrapscache-backup-.*\.scraps-cache-backup$/);
	// The download is deleted with its context, so keep a copy for the second browser.
	const file = testInfo.outputPath(download.suggestedFilename());
	await download.saveAs(file);
	await source.close();

	const target = await browser.newContext();
	const restored = await target.newPage();
	await openEmptyApp(restored);
	await expect(noteCard(restored, 'Backed up')).toBeHidden();

	await restored.getByRole('button', { name: 'Settings', exact: true }).click();
	await restored.getByRole('menuitem', { name: 'Import backup' }).click();
	await restored.locator('input[type="file"]').setInputFiles(file);
	const unlock = restored.getByRole('dialog').filter({ hasText: 'Unlock this backup' });
	await unlock.getByLabel('Backup passphrase').fill(passphrase);
	await unlock.getByRole('button', { name: 'Unlock and import' }).click();
	await restored.getByRole('button', { name: /^Keep local notes/ }).click();

	await expect(noteCard(restored, 'Backed up')).toBeVisible();
	await noteCard(restored, 'Backed up').click();
	await expect(restored.getByRole('textbox', { name: 'Note body' })).toContainText(
		'Keep this safe.'
	);
	await target.close();
});

test('a second workspace keeps its notes apart', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'First workspace note');

	await page.getByRole('button', { name: /^Sync settings/ }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: '+ New workspace' }).click();
	await dialog.getByRole('button', { name: /^Create workspace/ }).click();
	await expect(dialog.getByText('Created a local workspace on this device.')).toBeVisible();
	await dialog.getByRole('button', { name: 'Close' }).click();
	await expect(noteCard(page, 'First workspace note')).toBeHidden();

	await createNote(page, 'Second workspace note');

	await page.getByRole('button', { name: /^Sync settings/ }).click();
	await dialog.getByRole('button', { name: /^Switch to / }).click();
	await expect(dialog).toBeHidden();
	await expect(noteCard(page, 'First workspace note')).toBeVisible();
	await expect(noteCard(page, 'Second workspace note')).toBeHidden();
});
