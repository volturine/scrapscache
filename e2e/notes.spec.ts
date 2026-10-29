import { expect, test, type Locator } from '@playwright/test';
import {
	composer,
	composerPrompt,
	createNote,
	editor,
	noteCard,
	openEmptyApp,
	quickAction
} from './app';

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
	// An unchosen theme: the chosen one paints its own segment.
	const theme = page.getByRole('menuitemradio', { name: 'Dark', exact: true });
	await theme.focus();
	await expect(theme).toHaveCSS('outline-style', 'none');
	await expect(theme).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('a new note shows its body placeholder', async ({ page }) => {
	await openEmptyApp(page);
	await composerPrompt(page).click();
	await expect(composer(page).getByPlaceholder('Title', { exact: true })).toBeFocused();
	await page.keyboard.press('Enter');
	const body = composer(page).getByRole('textbox', { name: 'Note body' });
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
	const toggles = editor(page).getByRole('checkbox', { name: 'Toggle item' });
	await expect(toggles).toHaveCount(2);
	await expect(toggles.first()).toHaveAttribute('aria-checked', 'false');
	await toggles.first().click();
	await expect(toggles.first()).toHaveAttribute('aria-checked', 'true');
	await expect(toggles.last()).toHaveAttribute('aria-checked', 'false');

	// The card tells assistive technology the same: each item, with its state.
	await editor(page).getByRole('button', { name: 'Close note' }).click();
	const card = noteCard(page, 'Checklist');
	await expect(card.getByRole('checkbox', { name: 'milk' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await expect(card.getByRole('checkbox', { name: 'eggs' })).toHaveAttribute(
		'aria-checked',
		'false'
	);
});

test('focusing a checklist row moves no other row and offers + on the row itself', async ({
	page
}) => {
	await openEmptyApp(page);
	await createNote(page, 'Stable', '[ ] one\n[ ] two\n[ ] three');
	await noteCard(page, 'Stable').click();
	const sheet = editor(page);
	const rows = sheet.locator('[data-task-row]');
	await expect(rows).toHaveCount(3);
	const thirdRowTop = async () => (await rows.nth(2).boundingBox())!.y;
	const before = await thirdRowTop();

	await rows.nth(0).locator('[data-line-text]').click();
	const add = sheet.getByRole('button', { name: 'Add sub-task' });
	await expect(add).toBeVisible();
	// Nothing was inserted, so the rows below stay where they were.
	expect(await thirdRowTop()).toBeCloseTo(before, 1);
	// The + sits inside the focused row's box, so it never covers the rows beside it.
	const row = (await rows.nth(0).boundingBox())!;
	const plus = (await add.boundingBox())!;
	expect(plus.y).toBeGreaterThanOrEqual(row.y);
	expect(plus.y + plus.height).toBeLessThanOrEqual(row.y + row.height);
	expect(plus.x + plus.width).toBeLessThanOrEqual(row.x + row.width + 1);

	await add.click();
	await expect(rows).toHaveCount(4);
	await expect(rows.nth(1).locator('[data-line-text]')).toHaveAttribute(
		'data-placeholder',
		'Sub-task'
	);
});

test('focusing a task row that fills its line does not re-wrap it', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Full lines', `[ ] ${'word '.repeat(40)}\n[ ] after`);
	await noteCard(page, 'Full lines').click();
	const sheet = editor(page);
	const rows = sheet.locator('[data-task-row]');
	await expect(rows).toHaveCount(2);
	const first = async () => (await rows.nth(0).boundingBox())!;
	const second = async () => (await rows.nth(1).boundingBox())!;
	await rows.nth(1).locator('[data-line-text]').click();
	await expect(sheet.getByRole('button', { name: 'Add sub-task' })).toBeVisible();
	const heightBefore = (await first()).height;
	const topBefore = (await second()).y;

	await rows.nth(0).locator('[data-line-text]').click();
	await expect(rows.nth(0).getByRole('button', { name: 'Add sub-task' })).toBeVisible();

	// The room for the + was already there, so the wrapped line keeps its height.
	expect((await first()).height).toBeCloseTo(heightBefore, 1);
	expect((await second()).y).toBeCloseTo(topBefore, 1);
});

test('hiding a preview says what it does, and the card says the preview is hidden', async ({
	page
}) => {
	await openEmptyApp(page);
	await createNote(page, 'Wi-Fi and door codes', 'Guest network: hunter2');
	await noteCard(page, 'Wi-Fi and door codes').click();
	const sheet = editor(page);
	await sheet.getByRole('button', { name: 'Hide preview' }).click();
	await expect(page.getByRole('status')).toContainText(
		'Preview hidden in lists. Anyone using this device can still open the note.'
	);
	await expect(sheet.getByRole('button', { name: 'Show preview' })).toBeVisible();
	await sheet.getByRole('button', { name: 'Close note' }).click();

	const card = noteCard(page, 'Wi-Fi and door codes');
	await expect(card).toContainText('Preview hidden');
	// The title still reads; only the body is blurred.
	await expect(card.getByText('Wi-Fi and door codes')).toBeVisible();
	await expect(card.locator('[data-secret-content]')).toHaveCSS('filter', /blur/);
});

test('a checked row dims its text and tokens, not the whole row', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Dimmed', '[ ] milk `oat`\n[ ] eggs');
	await noteCard(page, 'Dimmed').click();
	const sheet = editor(page);
	const toggle = sheet.getByRole('checkbox', { name: 'Toggle item' }).first();
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-checked', 'true');

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

	await quickAction(noteCard(page, 'Travelling note'), 'Pin to top');
	await expect(page.getByRole('heading', { name: 'Pinned' })).toBeVisible();

	await quickAction(noteCard(page, 'Travelling note'), 'Archive');
	await expect(page.getByRole('status')).toContainText('Note archived');
	await expect(noteCard(page, 'Travelling note')).toBeHidden();

	await page.goto('/archive');
	await expect(noteCard(page, 'Travelling note')).toBeVisible();
	await quickAction(noteCard(page, 'Travelling note'), 'Restore');
	await expect(noteCard(page, 'Travelling note')).toBeHidden();

	await page.goto('/');
	await quickAction(noteCard(page, 'Travelling note'), 'Move to trash');
	await expect(page.getByRole('status')).toContainText('Moved to trash');
	await expect(noteCard(page, 'Travelling note')).toBeHidden();

	await page.goto('/trash');
	await expect(noteCard(page, 'Travelling note')).toBeVisible();
	await quickAction(noteCard(page, 'Travelling note'), 'Restore');
	await expect(noteCard(page, 'Travelling note')).toBeHidden();

	await page.goto('/');
	await expect(noteCard(page, 'Travelling note')).toBeVisible();
});

test('picking cards turns the top bar into an action bar that works on all of them', async ({
	page
}) => {
	await openEmptyApp(page);
	await createNote(page, 'First');
	await createNote(page, 'Second');
	await createNote(page, 'Third');

	// The checks stay hidden until a selection starts from a card's "…" menu.
	const title = noteCard(page, 'Third').getByRole('heading', { name: 'Third' });
	const titleBefore = await title.boundingBox();
	await expect(page.getByRole('checkbox', { name: 'Select First' })).toHaveCSS('opacity', '0');
	await quickAction(noteCard(page, 'First'), 'Select');
	const bar = page.getByRole('toolbar', { name: 'Selected notes' });
	await expect(bar).toContainText('1 selected');
	// Opening a selection moves nothing on the cards: the checks hang over their corners.
	expect(await title.boundingBox()).toEqual(titleBefore);
	await expect(page.getByRole('checkbox', { name: 'Select Third' })).toHaveCSS('opacity', '1');
	// With a selection open, a click on another card picks it rather than opening it.
	await noteCard(page, 'Second').click();
	await expect(bar).toContainText('2 selected');
	await expect(editor(page)).toBeHidden();

	await bar.getByRole('button', { name: 'Archive' }).click();
	await expect(page.getByRole('status')).toContainText('2 notes archived');
	await expect(noteCard(page, 'First')).toBeHidden();
	await expect(noteCard(page, 'Second')).toBeHidden();
	await expect(noteCard(page, 'Third')).toBeVisible();
	await expect(bar).toHaveCount(0);

	// One undo brings both back.
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(noteCard(page, 'First')).toBeVisible();
	await expect(noteCard(page, 'Second')).toBeVisible();
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
	await expect(page.getByText('No notes match “nothing like this”', { exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Clear search' }).click();
	await expect(noteCard(page, 'Apples')).toBeVisible();
	await expect(noteCard(page, 'Bolts')).toBeVisible();
	// Ready for the next query: the pressed button is gone, so focus goes to the field.
	await expect(search).toBeFocused();
});

test('extra cursors look like the native caret and selection', async ({ page }) => {
	await openEmptyApp(page);
	await composerPrompt(page).click();
	const body = composer(page).getByRole('textbox', { name: 'Note body' });
	await body.pressSequentially('cat cat cat');
	await page.keyboard.press('Home');
	// Mod+D selects the word, then adds the next match as an extra cursor.
	await page.keyboard.press('ControlOrMeta+d');
	await page.keyboard.press('ControlOrMeta+d');

	const caret = body.locator('..').locator('[data-extra-cursors] > span');
	await expect(caret).toHaveCount(1);
	const look = await caret.evaluate((mark) => {
		const editor = mark.closest('[data-extra-cursors]')!.previousElementSibling as HTMLElement;
		const line = editor.querySelector('[data-line-text]')!;
		const probe = document.createElement('span');
		probe.style.background = 'var(--colors-scrapscache-selection)';
		document.body.append(probe);
		const token = getComputedStyle(probe).backgroundColor;
		probe.remove();
		const style = getComputedStyle(mark);
		return {
			width: style.width,
			caret: style.backgroundColor,
			nativeCaret: getComputedStyle(editor).caretColor,
			blink: style.animationName,
			selection: getComputedStyle(line, '::selection').backgroundColor,
			token
		};
	});
	expect(look.width).toBe('1px');
	expect(look.caret).toBe(look.nativeCaret);
	expect(look.blink).toContain('caretBlink');
	expect(look.selection).toBe(look.token);
});

test('search chips narrow the feed, matches are marked, and a miss offers a new note', async ({
	page
}) => {
	await openEmptyApp(page);
	await createNote(page, 'Lisbon trip', 'Tram 28 early, before the crowds');
	await createNote(page, 'Porto', 'Port wine by the river');

	const search = page.getByPlaceholder('Search', { exact: true });
	await search.fill('tram');
	await expect(noteCard(page, 'Lisbon trip')).toBeVisible();
	await expect(page.locator('[data-search-count]')).toHaveText('1 note');
	// Why it matched: the query's text is marked in the card.
	await expect(noteCard(page, 'Lisbon trip').locator('mark')).toHaveText('Tram');

	// A chip that leaves nothing says so; clearing the chips brings the match back.
	await page.getByRole('button', { name: 'Colour' }).click();
	await page.getByRole('menuitemradio', { name: 'Blue', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Colour: Blue' })).toBeVisible();
	await expect(page.getByText('No notes match “tram” with these filters')).toBeVisible();
	await page.getByRole('button', { name: 'Clear filters' }).first().click();
	await expect(noteCard(page, 'Lisbon trip')).toBeVisible();

	// A miss offers the query as a new note's title, written in the composer.
	await search.fill('retro');
	await page.getByRole('button', { name: 'Create a note titled “retro”' }).click();
	await expect(composer(page).getByPlaceholder('Title', { exact: true })).toHaveValue('retro');
	await expect(composer(page).getByRole('textbox', { name: 'Note body' })).toBeFocused();
	await expect(search).toHaveValue('');
});

test('a card shows its … on hover and no edited time', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Quiet card', 'Nothing else');
	const card = noteCard(page, 'Quiet card');
	const actions = card.getByRole('button', { name: 'Note actions' });
	await page.mouse.move(1, 1);
	await expect(actions).toHaveCSS('opacity', '0');
	await card.hover();
	await expect(actions).toHaveCSS('opacity', '1');
	// The created or edited time is the open note's, not the card's.
	await expect(card).not.toContainText(/Edited|Created/);
});

test('a click outside the … menu closes it and still opens the note under the pointer', async ({
	page
}) => {
	await openEmptyApp(page);
	await createNote(page, 'Under the pointer');
	await createNote(page, 'With a menu');
	await noteCard(page, 'With a menu').click({ button: 'right' });
	await expect(page.getByRole('menu', { name: 'Note actions' })).toBeVisible();

	// A real hit test: the menu's app-wide frame must not take the click.
	await noteCard(page, 'Under the pointer').click();
	await expect(page.getByRole('menu', { name: 'Note actions' })).toHaveCount(0);
	await expect(editor(page)).toBeVisible();
	await expect(editor(page).getByPlaceholder('Title')).toHaveValue('Under the pointer');
});

test.describe('on a touch screen', () => {
	test.use({ hasTouch: true });

	test('a card always shows its … , since a touch screen has no hover', async ({ page }) => {
		await openEmptyApp(page);
		await createNote(page, 'Touch card');
		await expect(
			noteCard(page, 'Touch card').getByRole('button', { name: 'Note actions' })
		).toHaveCSS('opacity', '1');
	});

	test('the + on a focused task row grows a 44 px touch target that stays off the text', async ({
		page
	}) => {
		await openEmptyApp(page);
		await createNote(page, 'Touch tasks', '[ ] one\n[ ] two');
		await noteCard(page, 'Touch tasks').click();
		const sheet = editor(page);
		await sheet.locator('[data-task-row]').first().locator('[data-line-text]').click();
		const add = sheet.getByRole('button', { name: 'Add sub-task' });
		await expect(add).toBeVisible();

		const box = (await add.boundingBox())!;
		const target = await add.evaluate((button) => {
			const style = getComputedStyle(button, '::before');
			return {
				width: parseFloat(style.width),
				height: parseFloat(style.height),
				left: parseFloat(style.left),
				right: style.right
			};
		});
		// The glyph stays small; the target reaches 44 px, ending at the glyph's right edge
		// (the paint clip ends there) and reaching left only into the row's reserved gap.
		expect(box.width).toBeLessThan(30);
		expect(target.width).toBeGreaterThanOrEqual(44);
		expect(target.height).toBeGreaterThanOrEqual(44);
		expect(target.right).toBe('0px');
		expect(target.left).toBeLessThan(0);
		const text = (await sheet
			.locator('[data-task-row]')
			.first()
			.locator('[data-line-text]')
			.boundingBox())!;
		expect(box.x + target.left).toBeGreaterThanOrEqual(text.x + text.width - 1);
	});

	test('settings rows and segments keep their touch sizes at any width, and the popover scrolls', async ({
		page
	}) => {
		await page.setViewportSize({ width: 1024, height: 700 });
		await openEmptyApp(page);
		await page.getByRole('button', { name: 'Settings', exact: true }).click();
		const row = page.getByRole('menuitem', { name: 'Back up notes…' });
		const segment = page.getByRole('menuitemradio', { name: 'Dark', exact: true });
		// A tablet or a phone on its side is a coarse pointer wider than a phone. The
		// half-pixel allows for rem rounding. The popover scales in as it opens, so the
		// boxes are polled until the animation has settled rather than read once.
		await expect.poll(async () => (await row.boundingBox())!.height).toBeGreaterThanOrEqual(47.5);
		await expect
			.poll(async () => (await segment.boundingBox())!.height)
			.toBeGreaterThanOrEqual(43.5);
		await page.keyboard.press('Escape');

		// A short viewport: the popover scrolls inside the frame rather than being cut by it.
		await page.setViewportSize({ width: 1024, height: 380 });
		await page.getByRole('button', { name: 'Settings', exact: true }).click();
		const terms = page.getByRole('menuitem', { name: 'Terms' });
		await terms.scrollIntoViewIfNeeded();
		await expect(terms).toBeInViewport();
	});

	test('the tap that closes the quick actions does not open the note under it', async ({
		page
	}) => {
		await openEmptyApp(page);
		await createNote(page, 'Under the finger');
		await createNote(page, 'With quick actions');
		await noteCard(page, 'With quick actions').click({ button: 'right' });
		await expect(page.getByRole('menu', { name: 'Note actions' })).toBeVisible();

		const target = await noteCard(page, 'Under the finger').boundingBox();
		const tap = () =>
			page.touchscreen.tap(target!.x + target!.width / 2, target!.y + target!.height / 2);
		await tap();
		await expect(page.getByRole('menu', { name: 'Note actions' })).toHaveCount(0);
		await expect(editor(page)).toBeHidden();

		// Only the dismissing tap is swallowed: the next one opens the note.
		await tap();
		await expect(editor(page)).toBeVisible();
	});
});

test('search filters the archive', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Apples', 'Fruit for the week');
	await createNote(page, 'Bolts', 'Hardware for the shelf');
	await quickAction(noteCard(page, 'Apples'), 'Archive');
	await expect(noteCard(page, 'Apples')).toBeHidden();
	await quickAction(noteCard(page, 'Bolts'), 'Archive');
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

test('a search that finds nothing in Notes looks in Archive with the same query', async ({
	page
}) => {
	await openEmptyApp(page);
	await createNote(page, 'Retro board', 'Ideas for the next retro');
	await quickAction(noteCard(page, 'Retro board'), 'Archive');
	await expect(noteCard(page, 'Retro board')).toBeHidden();

	const search = page.getByPlaceholder('Search', { exact: true });
	await search.fill('retro');
	await expect(page.getByText('No notes match “retro”', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: /^Show [0-9]+ in Archive$/ }).click();

	await expect(page).toHaveURL(/\/archive$/);
	await expect(search).toHaveValue('retro');
	await expect(noteCard(page, 'Retro board')).toBeVisible();
});

test('a query typed on a wide window goes when the window narrows to a phone', async ({ page }) => {
	await page.setViewportSize({ width: 1024, height: 700 });
	await openEmptyApp(page);
	await createNote(page, 'Groceries');
	await createNote(page, 'Reading list');
	await page.getByPlaceholder('Search', { exact: true }).fill('Groceries');
	await expect(noteCard(page, 'Reading list')).toBeHidden();

	// A phone searches in the palette: its bar has no field to show the query or clear it.
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.getByRole('searchbox')).toHaveCount(0);
	await expect(noteCard(page, 'Reading list')).toBeVisible();
});

test('the palette finds notes in every place, labels and actions from the keyboard', async ({
	page
}) => {
	await openEmptyApp(page);
	await createNote(page, 'Tram day', 'Tram 28 early');
	await createNote(page, 'Old tram tickets', 'Lisbon');
	await quickAction(noteCard(page, 'Old tram tickets'), 'Archive');
	await expect(noteCard(page, 'Old tram tickets')).toBeHidden();

	await page.keyboard.press('ControlOrMeta+k');
	const palette = page.getByRole('dialog', { name: 'Search notes, labels and actions' });
	const field = palette.getByRole('combobox', { name: 'Search notes, labels and actions' });
	await expect(field).toBeFocused();
	await field.fill('tram');
	const notes = palette.getByRole('group', { name: 'Notes' }).getByRole('option');
	await expect(notes).toHaveCount(2);
	await expect(notes.nth(0)).toContainText('Tram day');
	await expect(notes.nth(1)).toContainText('Old tram tickets');
	await expect(notes.nth(1)).toContainText('Archived');

	// The archived note opens from here, though Notes does not list it.
	await page.keyboard.press('ArrowDown');
	await expect(notes.nth(1)).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('Enter');
	await expect(palette).toBeHidden();
	await expect(editor(page).getByRole('textbox', { name: 'Title' })).toHaveValue(
		'Old tram tickets'
	);
	await page.keyboard.press('Escape');
	await expect(editor(page)).toBeHidden();

	// The note opened last leads the list when nothing is typed; an action goes places.
	await page
		.getByRole('search')
		.getByRole('button', { name: 'Search notes, labels and actions' })
		.click();
	await expect(
		palette.getByRole('group', { name: 'Recent' }).getByRole('option').first()
	).toContainText('Old tram tickets');
	await field.fill('trash');
	await palette.getByRole('option', { name: /Go to Trash/ }).click();
	await expect(page).toHaveURL(/\/trash$/);
	await page.keyboard.press('ControlOrMeta+k');
	await expect(palette).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(palette).toBeHidden();
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

	test('the notes keep their scroll place across a visit to Labels', async ({ page }) => {
		await openEmptyApp(page);
		const feed = page.getByRole('main');
		const scrolls = () =>
			feed.evaluate((element) => element.scrollHeight > element.clientHeight + 200);
		for (let count = 1; count <= 16 && !(await scrolls()); count += 1) {
			await createNote(page, `Card ${count}`, 'One\nTwo\nThree\nFour\nFive');
		}
		expect(await scrolls()).toBe(true);
		await feed.evaluate((element) => element.scrollTo({ top: 200, behavior: 'instant' }));
		await expect.poll(() => feed.evaluate((element) => element.scrollTop)).toBe(200);

		const tabs = page.getByRole('navigation', { name: 'Main' });
		await tabs.getByRole('button', { name: 'Labels' }).click();
		await expect(page.locator('[data-view-title]')).toHaveText('Labels');
		await tabs.getByRole('button', { name: 'Notes' }).click();
		await expect(page.locator('[data-view-title]')).toHaveText('Notes');
		await expect.poll(() => feed.evaluate((element) => element.scrollTop)).toBe(200);
	});

	test('the tab bar carries the places, Labels holds the labels with Archive and Trash, and Search opens the palette', async ({
		page
	}) => {
		await openEmptyApp(page);
		await createNote(page, 'Tram day', 'Tram 28 early');
		await createNote(page, 'Quiet', 'Nothing here');
		const tabs = page.getByRole('navigation', { name: 'Main' });
		await expect(tabs.getByRole('button')).toHaveText([
			'Notes',
			'Reminders',
			'Kanban',
			'Labels',
			'Search'
		]);
		await expect(tabs.getByRole('button', { name: 'Notes' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		// The hamburger and the field are gone from the top bar; the view's name is there.
		await expect(page.getByRole('button', { name: 'Toggle sidebar' })).toHaveCount(0);
		await expect(page.getByRole('searchbox')).toHaveCount(0);
		await expect(page.locator('[data-view-title]')).toHaveText('Notes');

		// The composer sits under the top bar; there is no floating new-note button.
		await expect(composerPrompt(page)).toBeVisible();
		await expect(page.getByRole('button', { name: 'New note' })).toHaveCount(0);

		await tabs.getByRole('button', { name: 'Reminders' }).click();
		await expect(page).toHaveURL(/\/reminders$/);
		await expect(tabs.getByRole('button', { name: 'Reminders' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await expect(page.locator('[data-view-title]')).toHaveText('Reminders');

		await tabs.getByRole('button', { name: 'Notes' }).click();
		// With a phone keyboard up (the viewport code marks the page), the tab bar goes,
		// so an open note's layer reaches the keyboard instead of stopping a tab bar's
		// height above it. Read in one step: the viewport code recomputes the mark on
		// any focus or scroll and would clear it.
		const withKeyboard = await page.evaluate(() => {
			const root = document.documentElement;
			const tabs = document.querySelector<HTMLElement>('[data-phone-tabs]')!;
			const float = document.querySelector<HTMLElement>('[data-app-float]')!;
			const read = () => ({
				tabs: getComputedStyle(tabs).display,
				floatGap: Math.round(
					document.querySelector('.app-viewport')!.getBoundingClientRect().bottom -
						float.getBoundingClientRect().bottom
				)
			});
			root.classList.add('keyboard-open');
			const up = read();
			root.classList.remove('keyboard-open');
			return { up, down: read() };
		});
		expect(withKeyboard.up).toEqual({ tabs: 'none', floatGap: 0 });
		expect(withKeyboard.down.tabs).toBe('flex');
		expect(withKeyboard.down.floatGap).toBeGreaterThan(40);

		// Search opens the palette over the whole screen.
		await tabs.getByRole('button', { name: 'Search' }).click();
		const palette = page.getByRole('dialog', { name: 'Search notes, labels and actions' });
		const field = palette.getByRole('combobox', { name: 'Search notes, labels and actions' });
		await expect(field).toBeFocused();
		// Measured once its opening animation settles.
		await expect.poll(async () => (await palette.boundingBox())?.width).toBe(390);
		expect((await palette.boundingBox())!.y).toBe(0);
		await field.fill('tram');
		await expect(palette.getByRole('option')).toHaveCount(1);
		await palette.getByRole('option', { name: /Tram day/ }).click();
		await expect(palette).toBeHidden();
		await expect(editor(page).getByRole('textbox', { name: 'Title' })).toHaveValue('Tram day');
		await editor(page).getByRole('button', { name: 'Close note' }).click();
		await tabs.getByRole('button', { name: 'Search' }).click();
		await palette.getByRole('button', { name: 'Close search' }).click();
		await expect(palette).toBeHidden();
		await tabs.getByRole('button', { name: 'Notes' }).click();
		// The bar is a compact 3.5 rem.
		expect((await tabs.boundingBox())!.height).toBeLessThanOrEqual(57);

		// The title only names the view; More keeps the settings.
		await expect(page.locator('[data-view-title]')).not.toHaveAttribute('aria-haspopup');
		await page.getByRole('button', { name: 'More', exact: true }).click();
		await expect(page.getByRole('menuitem').first()).toHaveText('Back up notes…');
		await page.keyboard.press('Escape');

		// Labels is a place like the others: it sits between the bars, with Archive
		// and Trash under the labels, and the tab bar stays.
		await tabs.getByRole('button', { name: 'Labels' }).click();
		await expect(page.locator('[data-view-title]')).toHaveText('Labels');
		await expect(page).toHaveTitle('Labels · Scraps Cache');
		await expect(tabs.getByRole('button', { name: 'Labels' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await expect(tabs).toBeInViewport({ ratio: 1 });
		const places = page.getByRole('navigation', { name: 'Archive and Trash' });
		await expect(places.getByRole('button')).toHaveText(['Archive', 'Trash']);
		await expect(places).toBeInViewport({ ratio: 1 });
		await places.getByRole('button', { name: 'Archive' }).click();
		await expect(page).toHaveURL(/\/archive$/);
		await expect(page.locator('[data-view-title]')).toHaveText('Archive');
		// Archive is reached from Labels, so Labels stays lit.
		await expect(tabs.getByRole('button', { name: 'Labels' })).toHaveAttribute(
			'aria-current',
			'page'
		);

		await tabs.getByRole('button', { name: 'Labels' }).click();
		await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeHidden();
		const labelsList = page.getByRole('region', { name: 'Labels' });
		await labelsList.getByRole('button', { name: 'New label' }).click();
		await page.keyboard.type('Errands');
		await page.keyboard.press('Enter');
		// A new label opens its notes and puts the screen away.
		await expect(labelsList).toBeHidden();
		await expect(page.locator('[data-view-title]')).toHaveText('Errands');

		// Another tab leaves the Labels screen for its own place.
		await tabs.getByRole('button', { name: 'Labels' }).click();
		await tabs.getByRole('button', { name: 'Kanban' }).click();
		await expect(page).toHaveURL(/\/kanban$/);
		await expect(page.locator('[data-view-title]')).toHaveText('Kanban');
		await expect(page.getByRole('region', { name: 'Labels' })).toBeHidden();
	});
});

test('on a phone the composer stays under the top bar while the feed scrolls', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 640 });
	await openEmptyApp(page);
	const feed = page.getByRole('main');
	const scrolls = () => feed.evaluate((element) => element.scrollHeight > element.clientHeight);
	for (let count = 1; count <= 12 && !(await scrolls()); count += 1) {
		await createNote(page, `Card ${count}`, 'One\nTwo\nThree\nFour\nFive');
	}
	// The check means nothing unless the feed has an end to scroll to.
	expect(await scrolls()).toBe(true);

	const prompt = composerPrompt(page);
	const restingTop = (await prompt.boundingBox())!.y;
	await feed.evaluate((element) =>
		element.scrollTo({ top: element.scrollHeight, behavior: 'instant' })
	);
	expect(await feed.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	expect((await prompt.boundingBox())!.y).toBe(restingTop);
	await expect(prompt).toBeInViewport();
});
