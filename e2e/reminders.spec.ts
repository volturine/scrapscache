import { expect, test } from '@playwright/test';
import { createNote, editor, noteCard, noteCardOpen, openEmptyApp } from './app';

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
	// Focus returns to the card that opened the note.
	await expect(noteCardOpen(page, 'Call the vet')).toBeFocused();
	await expect(noteCardOpen(page, 'Call the vet')).toHaveAccessibleName(/overdue reminder/);

	await page.reload();
	await expect(noteCard(page, 'Call the vet')).toBeVisible();
	await expect(page.getByRole('region', { name: 'Due reminders' })).toBeHidden();
});

test('the reminder dialog opens on its typed field, not on the Sync settings link', async ({
	page
}) => {
	await openEmptyApp(page);
	await createNote(page, 'Water the plants');

	await noteCard(page, 'Water the plants').click();
	await editor(page).getByRole('button', { name: 'Reminder', exact: true }).click();
	const picker = page.getByRole('dialog').filter({ hasText: 'Will remind you' });
	// Sync is off here, so its settings link sits above the dates.
	await expect(picker.getByRole('button', { name: 'Open Sync settings' })).toBeVisible();
	await expect(picker.getByRole('textbox', { name: 'Type a date or time' })).toBeFocused();
});

test('a typed time is read, shown and saved with Enter', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Pick up the parcel');

	await noteCard(page, 'Pick up the parcel').click();
	await editor(page).getByRole('button', { name: 'Reminder', exact: true }).click();
	const picker = page.getByRole('dialog').filter({ hasText: 'Will remind you' });
	await page.keyboard.type('tomorrow 9:30am');
	await expect(
		picker.getByRole('listbox', { name: 'Hour' }).getByRole('option', { selected: true })
	).toHaveText('09');
	await expect(
		picker.getByRole('listbox', { name: 'Minute' }).getByRole('option', { selected: true })
	).toHaveText('30');
	await page.keyboard.press('Enter');

	await expect(picker).toBeHidden();
	await expect(
		editor(page)
			.getByRole('button', { name: /reminder/i })
			.first()
	).toHaveAccessibleName(/Tomorrow.*9:30/);
});
