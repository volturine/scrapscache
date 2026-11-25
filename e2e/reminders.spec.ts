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

test('a repeating reminder shows its next time and opens on it again', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Take out the bins');

	await noteCard(page, 'Take out the bins').click();
	await editor(page).getByRole('button', { name: 'Reminder', exact: true }).click();
	const picker = page.getByRole('dialog').filter({ hasText: 'Will remind you' });
	// Yesterday, every day: it starts at its next time instead of going off at once.
	await picker.getByRole('button', { name: 'Previous day' }).click();
	await picker.getByRole('button', { name: 'Does not repeat' }).click();
	await page.getByRole('menuitemradio', { name: 'Every day' }).click();
	await expect(picker.getByText(/, then every day$/)).toBeVisible();
	await picker.getByRole('button', { name: 'Save', exact: true }).click();

	const chip = editor(page).getByRole('button', { name: /^Repeating reminder,/ });
	await expect(chip).toHaveAccessibleName(/, daily$/);
	await expect(page.getByRole('region', { name: 'Due reminders' })).toBeHidden();

	await chip.click();
	await expect(picker.getByText('Active')).toBeVisible();
	await expect(picker.getByRole('button', { name: 'Every day' })).toBeVisible();
	await picker.getByRole('button', { name: 'Cancel' }).click();

	await page.keyboard.press('Escape');
	await expect(noteCardOpen(page, 'Take out the bins')).toHaveAccessibleName(
		/repeating reminder, .+, daily$/
	);
});

test('the Reminders view groups what is due and opens a note from its row', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Call the vet');
	await noteCard(page, 'Call the vet').click();
	await editor(page).getByRole('button', { name: 'Reminder', exact: true }).click();
	const picker = page.getByRole('dialog').filter({ hasText: 'Will remind you' });
	await picker.getByRole('button', { name: 'Previous day' }).click();
	await picker.getByRole('button', { name: 'Save', exact: true }).click();
	const due = page.getByRole('region', { name: 'Due reminders' });
	await due.getByRole('button', { name: 'Dismiss reminder' }).click();
	await page.keyboard.press('Escape');
	await expect(editor(page)).toBeHidden();

	await page.goto('/reminders');
	const overdue = page.getByRole('region', { name: 'Overdue' });
	await expect(overdue.getByRole('heading', { name: 'Overdue' })).toBeVisible();
	// "Previous day" lands a day back from the picker's next-hour default: late in the
	// evening that is earlier today rather than yesterday, so only the kind is checked.
	await expect(
		overdue.getByRole('button', { name: /^Open Call the vet, overdue reminder / })
	).toHaveCount(1);
	// The day it was due is marked red on the calendar.
	await expect(page.locator('.reminder-dot[data-overdue]')).toHaveCount(1);

	await overdue.getByRole('listitem').click();
	await expect(editor(page)).toBeVisible();
	await expect(editor(page).getByPlaceholder('Title', { exact: true })).toHaveValue('Call the vet');
});

test('over an open note, the reminder dialog scrolls in a window shorter than it', async ({
	page
}) => {
	// A short iPad window or a phone on its side: the picker is taller than the screen.
	await page.setViewportSize({ width: 1000, height: 560 });
	await openEmptyApp(page);
	await createNote(page, 'Renew the passport');

	await noteCard(page, 'Renew the passport').click();
	await editor(page).getByRole('button', { name: 'Reminder', exact: true }).click();
	const picker = page.getByRole('dialog').filter({ hasText: 'Will remind you' });
	// It opens on its top, the typed field in view, rather than centred with both ends cut.
	await expect(picker.getByText('Reminder', { exact: true })).toBeInViewport({ ratio: 1 });
	await expect(picker.getByRole('textbox', { name: 'Type a date or time' })).toBeInViewport({
		ratio: 1
	});
	// A wheel over the dialog's edge, away from the time wheels, brings Save up.
	const save = picker.getByRole('button', { name: 'Save', exact: true });
	await expect(save).not.toBeInViewport({ ratio: 1 });
	const box = await picker.getByText('Reminder', { exact: true }).boundingBox();
	await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
	await page.mouse.wheel(0, 1000);
	await expect(save).toBeInViewport({ ratio: 1 });
	await save.click();
	await expect(picker).toBeHidden();
	// The default time is the next hour, which can pass during a run just before it.
	await expect(
		editor(page).getByRole('button', { name: /^(?:overdue )?reminder,/i })
	).toBeVisible();
});

test.describe('on a tablet', () => {
	test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });

	test('the reminder dialog opens on the date controls, not the typed field', async ({ page }) => {
		await openEmptyApp(page);
		expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
		await createNote(page, 'Book the plumber');

		await noteCard(page, 'Book the plumber').click();
		await editor(page).getByRole('button', { name: 'Reminder', exact: true }).click();
		const picker = page.getByRole('dialog').filter({ hasText: 'Will remind you' });
		await expect(picker.getByRole('button', { name: 'Previous day' })).toBeFocused();
		await expect(picker.getByRole('textbox', { name: 'Type a date or time' })).not.toBeFocused();
	});
});
