import { expect, test } from '@playwright/test';
import { createNote, editor, noteCard, openEmptyApp } from './app';

test('a due reminder shows the in-app alert and can be dismissed', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Call the vet');

	await noteCard(page, 'Call the vet').click();
	await editor(page).getByRole('button', { name: 'Reminder', exact: true }).click();
	const picker = page.getByRole('dialog').filter({ hasText: 'Will remind you' });
	await picker.getByRole('button', { name: 'Previous day' }).click();
	await picker.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(editor(page).getByRole('button', { name: /^Overdue reminder,/ })).toBeVisible();

	// The alert lands over the open editor as soon as the reminder is due.
	const due = page.getByRole('region', { name: 'Due reminders' });
	await expect(due).toBeVisible();
	await expect(due.getByRole('alert')).toContainText('Call the vet');
	await due.getByRole('button', { name: 'Dismiss reminder' }).click();
	await expect(due).toBeHidden();

	await page.keyboard.press('Escape');
	await expect(editor(page)).toBeHidden();
	await expect(noteCard(page, 'Call the vet')).toHaveAccessibleName(/overdue reminder/);

	await page.reload();
	await expect(noteCard(page, 'Call the vet')).toBeVisible();
	await expect(page.getByRole('region', { name: 'Due reminders' })).toBeHidden();
});
