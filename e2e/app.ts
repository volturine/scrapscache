import { expect, type Locator, type Page } from '@playwright/test';

/** Open the app on an empty workspace: no starter notes, sidebar as the desktop layout shows it. */
export async function openEmptyApp(page: Page, path = '/'): Promise<void> {
	await page.addInitScript(() => localStorage.setItem('scrapscache-seeded', '1'));
	await page.goto(path);
	await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();
}

export function editor(page: Page): Locator {
	return page.getByRole('dialog', { name: 'Note editor' });
}

/** The card of a note in the feed, matched by its exact title. */
export function noteCard(page: Page, title: string): Locator {
	return page.getByRole('button', { name: new RegExp(`^Open ${escape(title)}(,|$)`) });
}

/** Create a note through the editor and close it, so the feed shows its card. */
export async function createNote(page: Page, title: string, body?: string): Promise<void> {
	await page.getByRole('button', { name: 'New note' }).click();
	const dialog = editor(page);
	await expect(dialog).toBeVisible();
	const bodyBox = dialog.getByRole('textbox', { name: 'Note body' });
	// A new note focuses its body on open and again 50 ms later; a title typed in
	// between lands in the body, so let the second focus pass first.
	await expect(bodyBox).toBeFocused();
	await page.waitForTimeout(100);
	await dialog.getByPlaceholder('Title', { exact: true }).fill(title);
	if (body) {
		await bodyBox.click();
		await bodyBox.pressSequentially(body);
	}
	await dialog.getByRole('button', { name: 'Close note' }).click();
	await expect(dialog).toBeHidden();
	await expect(noteCard(page, title)).toBeVisible();
}

/** Open the quick actions of a card and press one of them. */
export async function quickAction(card: Locator, name: string): Promise<void> {
	await card.click({ button: 'right' });
	await card.getByRole('button', { name, exact: true }).click();
}

function escape(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
