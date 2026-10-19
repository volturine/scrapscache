import { expect, test, type Locator } from '@playwright/test';
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

test('the note sheet does not draw a browser focus ring around itself', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Focus sample');
	await noteCard(page, 'Focus sample').click();

	const dialog = editor(page);
	await expect(dialog).toBeVisible();
	await expect
		.poll(() => dialog.evaluate((element) => getComputedStyle(element).outlineStyle))
		.toBe('none');

	await page.keyboard.press('Tab');
	const closeButton = dialog.getByRole('button', { name: 'Close note' });
	await expect(closeButton).toBeFocused();
	const focusRing = await closeButton.evaluate((element) => {
		const style = getComputedStyle(element);
		return { visible: element.matches(':focus-visible'), outlineStyle: style.outlineStyle };
	});
	expect(focusRing).toMatchObject({ visible: true, outlineStyle: 'none' });
});

test('controls keep keyboard focus without drawing highlights', async ({ page }) => {
	await openEmptyApp(page);
	await page.keyboard.press('Tab');
	for (const control of [
		page.getByRole('button', { name: 'Settings', exact: true }),
		page.getByRole('button', { name: 'Notes', exact: true }),
		page.getByRole('search').getByRole('searchbox', { name: 'Search notes', exact: true })
	]) {
		await control.focus();
		await expect(control).toBeFocused();
		await expect(control).toHaveCSS('outline-style', 'none');
		await expect(control).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
	}

	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	const theme = page.getByRole('menuitem', { name: /^(Dark|Light) mode$/ });
	await theme.focus();
	await expect(theme).toHaveCSS('outline-style', 'none');
	await expect(theme).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('a new note shows its body placeholder', async ({ page }) => {
	await openEmptyApp(page);
	await page.getByRole('button', { name: 'New note' }).click();
	const body = editor(page).getByRole('textbox', { name: 'Note body' });
	await expect(body).toBeFocused();

	// The empty line holds a zero-width caret holder, so the hint must not need :empty.
	const line = body.locator('[data-line-text]');
	const hint = () => line.evaluate((element) => getComputedStyle(element, '::after').content);
	await expect(line).toHaveAttribute('data-placeholder', /^Take a note/);
	expect(await hint()).toContain('Take a note');

	// The caret sits in front of the hint, at the start of the line.
	const caretX = await page.evaluate(
		() => window.getSelection()!.getRangeAt(0).getBoundingClientRect().x
	);
	const lineX = await line.evaluate((element) => element.getBoundingClientRect().x);
	expect(Math.abs(caretX - lineX)).toBeLessThanOrEqual(1);

	// Assistive technology gets the hint as a placeholder, not as body text.
	await expect(body).toHaveAttribute('aria-placeholder', /^Take a note/);
	expect(await body.ariaSnapshot()).not.toContain('Take a note');

	// While an IME composes, its text is not on the line yet, and the hint steps aside.
	await body.dispatchEvent('compositionstart');
	expect(await hint()).toBe('none');
	await body.dispatchEvent('compositionend');
	expect(await hint()).toContain('Take a note');

	// The first keystroke replaces the hint.
	await page.keyboard.type('x');
	await expect(body).toContainText('x');
	expect(await hint()).toBe('none');
	await expect(body).not.toHaveAttribute('aria-placeholder');
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

test('a checked row dims its text and tokens, not the whole row', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Dimmed', '[ ] milk `oat`\n[ ] eggs');
	await noteCard(page, 'Dimmed').click();
	const sheet = editor(page);
	const toggle = sheet.getByRole('button', { name: 'Toggle item' }).first();
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');

	const colour = (target: Locator) => target.evaluate((element) => getComputedStyle(element).color);
	// A colour token as this note's surface resolves it.
	const resolve = (token: string) =>
		sheet.evaluate((element, token) => {
			const probe = document.createElement('span');
			probe.style.color = `var(${token})`;
			element.append(probe);
			const value = getComputedStyle(probe).color;
			probe.remove();
			return value;
		}, token);
	const muted = await resolve('--colors-scrapscache-text-muted');
	const lines = sheet.locator('[data-line-text]');
	await expect(lines).toHaveCount(2);
	const checked = lines.first();
	expect(await colour(checked)).toBe(muted);
	expect(await colour(checked.locator('.markdown-token-code'))).toBe(muted);
	expect(await colour(lines.last())).not.toBe(muted);
	// Opacity would also wash out a selection dragged across the row.
	await expect(checked).toHaveCSS('opacity', '1');
	await expect(checked).toHaveCSS('text-decoration-line', 'line-through');

	// The find bar's current match keeps its own colour on a checked line.
	await sheet.locator('[data-body-editor]').press('ControlOrMeta+f');
	await sheet.getByRole('textbox', { name: 'Find', exact: true }).fill('oat');
	await expect(sheet.locator('[data-editor-find-count]')).toHaveText('1 of 1');
	const currentMatch = await checked.evaluate(
		(element) => getComputedStyle(element, '::highlight(note-find-current)').backgroundColor
	);
	expect(currentMatch).toBe(await resolve('--colors-scrapscache-warning'));

	await sheet.getByRole('button', { name: 'Close note' }).click();
	const cardLine = noteCard(page, 'Dimmed').locator('[data-check-line="0"] > span').last();
	expect(await colour(cardLine)).toBe(muted);
	expect(await colour(cardLine.locator('.markdown-token-code'))).toBe(muted);
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

test('search filters the archive', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Apples', 'Fruit for the week');
	await createNote(page, 'Bolts', 'Hardware for the shelf');
	await quickAction(noteCard(page, 'Apples'), 'Archive note');
	await expect(noteCard(page, 'Apples')).toBeHidden();
	await quickAction(noteCard(page, 'Bolts'), 'Archive note');
	await expect(noteCard(page, 'Bolts')).toBeHidden();

	await page.goto('/archive');
	const search = page.getByPlaceholder('Search', { exact: true });
	await search.fill('shelf');
	await expect(noteCard(page, 'Bolts')).toBeVisible();
	await expect(noteCard(page, 'Apples')).toBeHidden();

	await page.getByRole('button', { name: 'Clear search' }).click();
	await expect(noteCard(page, 'Apples')).toBeVisible();
	await expect(noteCard(page, 'Bolts')).toBeVisible();
});

test('the last card stays clear of the new note button', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 640 });
	await openEmptyApp(page);
	const feed = page.getByRole('main');
	const scrolls = () => feed.evaluate((element) => element.scrollHeight > element.clientHeight);
	for (let count = 1; count <= 12 && !(await scrolls()); count += 1) {
		await createNote(page, `Card ${count}`, 'One\nTwo\nThree\nFour\nFive');
	}
	// The check means nothing unless the feed has an end to scroll to.
	expect(await scrolls()).toBe(true);

	const clearance = async () => {
		await feed.evaluate((element) =>
			element.scrollTo({ top: element.scrollHeight, behavior: 'instant' })
		);
		const lowestCard = await page
			.getByRole('article')
			.evaluateAll((cards) =>
				Math.max(...cards.map((card) => card.getBoundingClientRect().bottom))
			);
		const button = await page.getByRole('button', { name: 'New note' }).boundingBox();
		return button!.y - lowestCard;
	};
	expect(await clearance()).toBeGreaterThanOrEqual(0);

	// An overlaid phone keyboard lifts the button; appViewport publishes its height here.
	await page.evaluate(() =>
		document.documentElement.style.setProperty('--app-keyboard-bottom', '336px')
	);
	expect(await clearance()).toBeGreaterThanOrEqual(0);
});
