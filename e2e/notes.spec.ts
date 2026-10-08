import { expect, test } from '@playwright/test';
import { createNote, editor, noteCard, openEmptyApp, quickAction } from './app';

test('a note survives a reload and an offline reload', async ({ page, context }) => {
	await openEmptyApp(page);
	await createNote(page, 'Offline note', 'Written before the network went away.');

	await page.reload();
	await expect(noteCard(page, 'Offline note')).toBeVisible();

	// The service worker needs one controlled load before it can serve the shell offline.
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.reload();
	await context.setOffline(true);
	await page.reload();
	await expect(noteCard(page, 'Offline note')).toBeVisible();

	await noteCard(page, 'Offline note').click();
	await expect(editor(page).getByRole('textbox', { name: 'Note body' })).toContainText(
		'Written before the network went away.'
	);
	await context.setOffline(false);
});

test('a checklist line toggles from the body', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Checklist', '[ ] milk\n[ ] eggs');

	await noteCard(page, 'Checklist').click();
	const body = editor(page).getByRole('textbox', { name: 'Note body' });
	await expect(body).toContainText('milk');
	await expect(body).toContainText('eggs');
	const toggles = editor(page).getByRole('button', { name: 'Toggle item' });
	await expect(toggles).toHaveCount(2);
	await expect(toggles.first()).toHaveAttribute('aria-pressed', 'false');
	await toggles.first().click();
	await expect(toggles.first()).toHaveAttribute('aria-pressed', 'true');
	await expect(toggles.last()).toHaveAttribute('aria-pressed', 'false');
});

test('pin, archive, trash and restore move a note between views', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Travelling note');

	await quickAction(noteCard(page, 'Travelling note'), 'Pin note');
	await expect(page.getByRole('heading', { name: 'Pinned' })).toBeVisible();

	await quickAction(noteCard(page, 'Travelling note'), 'Archive note');
	await expect(page.getByRole('status')).toContainText('Note archived');
	await expect(noteCard(page, 'Travelling note')).toBeHidden();

	await page.goto('/archive');
	await expect(noteCard(page, 'Travelling note')).toBeVisible();
	await quickAction(noteCard(page, 'Travelling note'), 'Restore note');
	await expect(noteCard(page, 'Travelling note')).toBeHidden();

	await page.goto('/');
	await quickAction(noteCard(page, 'Travelling note'), 'Delete note');
	await expect(page.getByRole('status')).toContainText('Moved to trash');
	await expect(noteCard(page, 'Travelling note')).toBeHidden();

	await page.goto('/trash');
	await expect(noteCard(page, 'Travelling note')).toBeVisible();
	await quickAction(noteCard(page, 'Travelling note'), 'Restore note');
	await expect(noteCard(page, 'Travelling note')).toBeHidden();

	await page.goto('/');
	await expect(noteCard(page, 'Travelling note')).toBeVisible();
});

test('search narrows the feed to matching notes', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Apples', 'Fruit for the week');
	await createNote(page, 'Bolts', 'Hardware for the shelf');

	const search = page.getByPlaceholder('Search', { exact: true });
	await search.fill('shelf');
	await expect(noteCard(page, 'Bolts')).toBeVisible();
	await expect(noteCard(page, 'Apples')).toBeHidden();

	await search.fill('nothing like this');
	await expect(page.getByText('No notes found')).toBeVisible();

	await page.getByRole('button', { name: 'Clear search' }).click();
	await expect(noteCard(page, 'Apples')).toBeVisible();
	await expect(noteCard(page, 'Bolts')).toBeVisible();
});
