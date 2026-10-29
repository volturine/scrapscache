import { expect, type Locator, type Page } from '@playwright/test';

/** Open the app on an empty workspace: no starter notes, sidebar as the desktop layout shows it. */
export async function openEmptyApp(page: Page, path = '/'): Promise<void> {
	await page.addInitScript(() => localStorage.setItem('scrapscache-seeded', '1'));
	await page.goto(path);
	await expect(composerPrompt(page)).toBeVisible();
}

/** The "Take a note…" bar at the head of the feed, closed or open. */
export function composer(page: Page): Locator {
	return page.getByRole('region', { name: 'New note' });
}

/** The closed bar's prompt; the empty state has a "Take a note" button of its own. */
export function composerPrompt(page: Page): Locator {
	return composer(page).getByRole('button', { name: /^Take a note/ });
}

export function editor(page: Page): Locator {
	return page.getByRole('dialog', { name: 'Note editor' });
}

/** The open control of a note's card, matched by the card's exact title. */
export function noteCardOpen(page: Page, title: string): Locator {
	return page.getByRole('button', { name: new RegExp(`^Open ${escape(title)}(,|$)`) });
}

/** The card of a note in the feed: the article holding its open control and quick actions. */
export function noteCard(page: Page, title: string): Locator {
	return page.getByRole('article').filter({ has: noteCardOpen(page, title) });
}

/** Create a note in the composer and put it away, so the feed shows its card. */
export async function createNote(page: Page, title: string, body?: string): Promise<void> {
	await composerPrompt(page).click();
	const bar = composer(page);
	const titleBox = bar.getByPlaceholder('Title', { exact: true });
	const bodyBox = bar.getByRole('textbox', { name: 'Note body' });
	await expect(titleBox).toBeFocused();
	await titleBox.fill(title);
	if (body) {
		await bodyBox.click();
		await bodyBox.pressSequentially(body);
	}
	await bar.getByRole('button', { name: 'Done' }).click();
	await expect(bodyBox).toBeHidden();
	await expect(noteCard(page, title)).toBeVisible();
	// The new card slides in, and cards around it may re-enter their columns; a
	// position read before that settles is not where anything will stay. An animation
	// cut short (its card replaced by a sync) rejects, which settles it just as well.
	await page.evaluate(() =>
		Promise.allSettled(document.getAnimations().map((animation) => animation.finished))
	);
}

/** Open the quick actions of a card and press one of them. */
/** Run one of a card's actions from its "…" menu. */
export async function quickAction(card: Locator, name: string): Promise<void> {
	await card.getByRole('button', { name: 'Note actions' }).click();
	await card
		.page()
		.getByRole('menu', { name: 'Note actions' })
		.getByRole('menuitem', { name, exact: true })
		.click();
}

function escape(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
